from urllib.parse import unquote

from django.http import FileResponse, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.generics import ListAPIView, RetrieveDestroyAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from django.utils import timezone

from .models import Scan, Project
from .serializers import ScanSerializer
from projects.utils.zip_validator import InvalidZipArchive, inspect_zip
from projects.utils.archive import local_archive_path
from .services.archive_link import resolve_project
from .services.scanner_runner import scanner_availability, SUPPORTED_SCANNERS
from .services.scan_worker import scan_worker_snapshot
from .services.worker_launcher import ensure_worker_running
from .services.dashboard_overview import DashboardOverviewService
from .services.findings import find_finding, public_finding
from .services.source_context import extract_source_context
from .services.ai_explanation import (
    chat_about_finding,
    generate_explanation,
    stream_explanation,
)
from .services.ai_provider import AIProviderError, AIProviderRateLimitError

import json
import logging
import os
import uuid

logger = logging.getLogger('scans.worker')


class DashboardOverviewView(APIView):
    """Dashboard metrics scoped to the authenticated user's data."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        time_range = request.query_params.get('timeRange', '7d')
        data = DashboardOverviewService.get_overview(user=request.user, time_range=time_range)
        return Response(data, status=status.HTTP_200_OK)


class ScanListView(ListAPIView):
    """Return only scans belonging to the authenticated user's projects."""
    serializer_class = ScanSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Scan.objects.filter(
            project__owner=self.request.user
        ).order_by('-started_at')


class ScanDetailView(RetrieveDestroyAPIView):
    """Return or delete a scan; 404 if it does not belong to the current user."""
    serializer_class = ScanSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Scan.objects.filter(project__owner=self.request.user)

    def destroy(self, request, *args, **kwargs):
        scan = self.get_object()
        if scan.status in Scan.ACTIVE_STATUSES:
            return Response(
                {'error': 'An active scan cannot be deleted until it finishes.'},
                status=status.HTTP_409_CONFLICT,
            )
        self.perform_destroy(scan)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ScanStatusView(APIView):
    """
    Lightweight status endpoint used by the frontend progress page.

    Returns the real lifecycle status, stage, progress, per-scanner state and
    whether a scan worker is currently online — without restarting the scan
    and without including the (potentially large) result payload.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        scan = get_object_or_404(Scan, pk=pk, project__owner=request.user)
        snapshot = scan_worker_snapshot(scan)

        # Self-healing: if the scan is still waiting and no worker is online,
        # start one.  The frontend polls this endpoint, so a scan can never
        # stay queued just because nobody started the worker by hand.
        if not snapshot['worker_online'] and not snapshot['is_terminal']:
            ensure_worker_running(reason=f'scan-{scan.pk}-status-poll')

        return Response(snapshot, status=status.HTTP_200_OK)


class ScannerAvailabilityView(APIView):
    """
    Cached availability of the integrated scanner executables.

    Missing tools are reported explicitly (with an install hint) instead of
    being discovered halfway through a scan.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(scanner_availability(), status=status.HTTP_200_OK)


class ArchiveDownloadView(APIView):
    """
    Stream a project's ZIP archive to a caller holding a signed token.

    Used by the GitHub Actions Semgrep runner (see
    ``scans/services/archive_link.py``): the scan worker mints a
    short-lived link, passes it to the workflow as an input, and the runner
    fetches the archive here without needing a user login.  The token is
    the only credential — it expires after
    ``CODEGUARD_ARCHIVE_TOKEN_MAX_AGE`` seconds and cannot be forged
    without ``DJANGO_SECRET_KEY``.

    Every failure mode answers 404: an expired or bogus token must not
    reveal whether the archive exists.
    """
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        project = resolve_project(request.query_params.get('token'))
        if project is None:
            return Response(
                {'error': 'Invalid or expired archive link.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            file_handle = project.zip_file.open('rb')
        except Exception:  # noqa: BLE001 — missing file, dead storage, …
            logger.warning('Archive download failed for project %s', project.pk, exc_info=True)
            return Response({'error': 'Archive not found.'}, status=status.HTTP_404_NOT_FOUND)

        filename = os.path.basename(project.zip_file.name or 'project.zip')
        return FileResponse(
            file_handle,
            as_attachment=True,
            filename=filename,
            content_type='application/zip',
        )


class StartScanView(APIView):
    """
    Create a scan record and enqueue it for background execution.

    This endpoint is deliberately lightweight: it validates ownership and the
    uploaded archive (central-directory read only — no extraction, no scanner
    processes), persists a scan with status ``queued`` and returns 201
    immediately.  The actual scanning runs in the background worker
    (``python manage.py runscanworker``).
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        project_id = request.data.get('project_id')
        scanners = request.data.get("selected_scanners", [])

        if not project_id:
            return Response({'error': 'project_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        if not isinstance(scanners, list) or not scanners or not all(isinstance(s, str) for s in scanners):
            return Response(
                {'error': 'selected_scanners must be a non-empty list of scanner names.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Reject scanner names the backend cannot run (e.g. the removed
        # UI-only "config" option) instead of queuing a scan doomed to fail.
        unsupported = [s for s in scanners if s not in SUPPORTED_SCANNERS]
        if unsupported:
            return Response(
                {
                    'error': 'Unsupported scanner(s): '
                             + ', '.join(sorted(set(unsupported)))
                             + '.',
                    'supported_scanners': list(SUPPORTED_SCANNERS),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # De-duplicate while preserving the caller's order.
        scanners = list(dict.fromkeys(scanners))

        try:
            project_uuid = uuid.UUID(str(project_id))
        except (ValueError, TypeError, AttributeError):
            return Response(
                {'error': 'project_id must be a valid project UUID.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Enforce ownership: non-existent or foreign projects both return 404.
        project = get_object_or_404(Project, id=project_uuid, owner=request.user)

        # Cheap archive validation — reads the ZIP central directory only.
        # Nothing is extracted and no scanner process is started here.
        try:
            with local_archive_path(project) as zip_path:
                validation = inspect_zip(zip_path)
        except InvalidZipArchive as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        scan = Scan.objects.create(
            project=project,
            scanners=scanners,
            status='queued',
            stage='queued',
            progress=0,
            started_at=timezone.now(),
            completed_at=None,
            result={'validation': validation, 'scans': {}},
        )
        logger.info('Scan %s queued for project %s by user %s', scan.pk, project.pk, request.user.pk)

        # Make sure somebody picks the scan up: when no worker is running the
        # API starts one automatically (see scans.services.worker_launcher).
        # The scan row is already queued, so this never delays the response.
        ensure_worker_running(reason=f'scan-{scan.pk}-queued')

        serializer = ScanSerializer(scan)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ResolveScanView(APIView):
    """Mark a scan as resolved. Only the owning user may do this."""
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        scan = get_object_or_404(Scan, pk=pk, project__owner=request.user)
        scan.status = 'resolved'
        scan.save()
        serializer = ScanSerializer(scan)
        return Response(serializer.data)


class DismissFindingView(APIView):
    """Dismiss or un-dismiss a finding within a scan the current user owns."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        scan = get_object_or_404(Scan, pk=pk, project__owner=request.user)
        finding_id = request.data.get('finding_id')

        if not finding_id:
            return Response({'error': 'finding_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        if finding_id not in scan.dismissed_findings:
            scan.dismissed_findings.append(finding_id)
            scan.save()

        return Response({'success': True, 'dismissed_findings': scan.dismissed_findings})

    def delete(self, request, pk):
        scan = get_object_or_404(Scan, pk=pk, project__owner=request.user)
        finding_id = request.data.get('finding_id')

        if not finding_id:
            return Response({'error': 'finding_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        if finding_id in scan.dismissed_findings:
            scan.dismissed_findings.remove(finding_id)
            scan.save()

        return Response({'success': True, 'dismissed_findings': scan.dismissed_findings})


# ─────────────────────────────────────────────────────────────────────────────
# AI vulnerability explanation
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_finding(scan, url_finding_id, body_finding_id=None):
    """
    Resolve a finding inside ``scan``.

    The identifier comes from the URL, with the request body accepted as a
    fallback (package names in dependency findings may contain a ``/`` which
    some HTTP servers refuse to keep percent-encoded in the path).  The scan
    is always owner-scoped before this helper runs, so a finding id can never
    be used to reach another user's results.

    The URL segment is percent-decoded first: Django routes on the *raw*
    path, so an id such as ``dep_%40babel%2Fcore`` still reaches this view
    percent-encoded.  Both candidates are tried, encoded and decoded, so the
    lookup succeeds no matter how the client spelled the id.
    """
    candidates = []
    for candidate in (url_finding_id, body_finding_id):
        if not candidate:
            continue
        raw = str(candidate)
        try:
            decoded = unquote(raw)
        except Exception:
            decoded = raw
        for value in (raw, decoded):
            if value and value not in candidates:
                candidates.append(value)

    for candidate in candidates:
        finding = find_finding(scan, candidate)
        if finding:
            return finding
    return None


class FindingDetailView(APIView):
    """
    GET /api/scans/<pk>/findings/<finding_id>/

    Return the authoritative finding data for one finding of a scan the
    authenticated user owns, plus the source context extracted from the
    uploaded project archive (when the file can be located).

    This endpoint never calls an AI provider — it is a cheap lookup used to
    show the real scanner metadata next to the explanation.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk, finding_id):
        scan = get_object_or_404(Scan, pk=pk, project__owner=request.user)
        finding = _resolve_finding(scan, finding_id)

        if not finding:
            return Response(
                {'error': 'Finding not found in this scan.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        source_context = extract_source_context(
            scan.project, finding.get('file'),
            finding.get('line'), finding.get('end_line'),
        )

        return Response(
            {
                'finding': public_finding(finding),
                'source_context': source_context,
                'scan': {
                    'id': scan.pk,
                    'project': str(scan.project_id),
                    'project_name': scan.project.name,
                    'status': scan.status,
                    'scanners': scan.scanners or [],
                    'started_at': scan.started_at,
                },
            },
            status=status.HTTP_200_OK,
        )


class FindingExplanationView(APIView):
    """
    POST /api/scans/<pk>/findings/<finding_id>/explain/

    Generate an AI explanation for one finding of a scan the authenticated user
    owns.

    The finding itself is resolved from the stored scan result — the client
    only names which finding it wants explained, it can never inject the
    content of the explanation.  Provider failures (missing configuration,
    invalid credentials, rate limits, timeouts, malformed answers) are turned
    into predictable JSON errors that contain no provider internals.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk, finding_id):
        scan = get_object_or_404(Scan, pk=pk, project__owner=request.user)

        body_finding_id = None
        if isinstance(request.data, dict):
            body_finding_id = request.data.get('finding_id')

        finding = _resolve_finding(scan, finding_id, body_finding_id)
        if not finding:
            return Response(
                {'error': 'Finding not found in this scan.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        source_context = extract_source_context(
            scan.project, finding.get('file'),
            finding.get('line'), finding.get('end_line'),
        )

        if request.query_params.get('stream') == '1':
            def event(data, name):
                return (
                    f'event: {name}\n'
                    f'data: {json.dumps(data, ensure_ascii=True, separators=(",", ":"))}\n\n'
                )

            def stream_events():
                try:
                    for item in stream_explanation(finding, source_context):
                        if item['type'] == 'complete':
                            yield event(
                                {
                                    'finding': public_finding(finding),
                                    'source_context': source_context,
                                    'explanation': item['explanation'],
                                },
                                'complete',
                            )
                        else:
                            yield event({'text': item['text']}, 'content')
                except AIProviderRateLimitError as exc:
                    payload = {
                        'error': exc.message,
                        'code': exc.code,
                        'retryable': True,
                    }
                    if exc.retry_after:
                        payload['retry_after'] = exc.retry_after
                    yield event(payload, 'error')
                except AIProviderError as exc:
                    logger.warning(
                        'Streaming AI explanation failed for scan %s finding %s: %s',
                        scan.pk, finding.get('id'), exc.code,
                    )
                    yield event(
                        {
                            'error': exc.message,
                            'code': exc.code,
                            'retryable': exc.retryable,
                        },
                        'error',
                    )
                except Exception:
                    logger.exception(
                        'Unexpected streaming AI explanation failure for scan %s finding %s',
                        scan.pk, finding.get('id'),
                    )
                    yield event(
                        {
                            'error': 'The explanation could not be generated. Please try again.',
                            'code': 'ai_unknown_error',
                            'retryable': True,
                        },
                        'error',
                    )

            response = StreamingHttpResponse(
                stream_events(),
                content_type='text/event-stream; charset=utf-8',
            )
            response['Cache-Control'] = 'no-cache, no-transform'
            response['X-Accel-Buffering'] = 'no'
            return response

        try:
            explanation = generate_explanation(finding, source_context)
        except AIProviderRateLimitError as exc:
            payload = {
                'error': exc.message,
                'code': exc.code,
                'retryable': True,
            }
            if exc.retry_after:
                payload['retry_after'] = exc.retry_after
            return Response(payload, status=exc.status_code)
        except AIProviderError as exc:
            logger.warning(
                'AI explanation failed for scan %s finding %s: %s',
                scan.pk, finding.get('id'), exc.code,
            )
            return Response(
                {
                    'error': exc.message,
                    'code': exc.code,
                    'retryable': exc.retryable,
                },
                status=exc.status_code,
            )

        return Response(
            {
                'finding': public_finding(finding),
                'source_context': source_context,
                'explanation': explanation,
            },
            status=status.HTTP_200_OK,
        )


class FindingChatView(APIView):
    """Answer a follow-up question grounded in one owned scan finding."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk, finding_id):
        scan = get_object_or_404(Scan, pk=pk, project__owner=request.user)
        if not isinstance(request.data, dict):
            return Response(
                {'error': 'A JSON object is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        finding = _resolve_finding(scan, finding_id, request.data.get('finding_id'))
        if not finding:
            return Response(
                {'error': 'Finding not found in this scan.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        message = request.data.get('message')
        history = request.data.get('history', [])
        if not isinstance(message, str) or not message.strip() or len(message) > 2000:
            return Response(
                {'error': 'message must contain 1 to 2000 characters.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not isinstance(history, list) or len(history) > 8:
            return Response(
                {'error': 'history must contain no more than 8 messages.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        for item in history:
            if (
                not isinstance(item, dict)
                or item.get('role') not in ('user', 'assistant')
                or not isinstance(item.get('content'), str)
                or not item['content'].strip()
                or len(item['content']) > 2000
            ):
                return Response(
                    {'error': 'history messages must have a valid role and 1 to 2000 characters.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        source_context = extract_source_context(
            scan.project, finding.get('file'),
            finding.get('line'), finding.get('end_line'),
        )

        try:
            result = chat_about_finding(
                public_finding(finding),
                source_context,
                history,
                message.strip(),
            )
        except AIProviderRateLimitError as exc:
            payload = {'error': exc.message, 'code': exc.code, 'retryable': True}
            if exc.retry_after:
                payload['retry_after'] = exc.retry_after
            return Response(payload, status=exc.status_code)
        except AIProviderError as exc:
            logger.warning(
                'AI finding chat failed for scan %s finding %s: %s',
                scan.pk, finding.get('id'), exc.code,
            )
            return Response(
                {'error': exc.message, 'code': exc.code, 'retryable': exc.retryable},
                status=exc.status_code,
            )

        return Response(result, status=status.HTTP_200_OK)
