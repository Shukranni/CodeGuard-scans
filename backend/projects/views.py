from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated

from .models import Project
from .serializers import ZipUploadSerializer, ProjectListSerializer, GitHubRepositorySerializer
from .utils.zip_validator import InvalidZipArchive, validate_zip
from .utils.archive import local_archive_path
from .utils.github import (
    GitHubRepositoryError,
    build_source_archive,
    fetch_repository,
    parse_repository_url,
)
import zipfile
import logging
import os
import posixpath
import re
import shutil
import tempfile
from django.conf import settings
from django.core.files import File

logger = logging.getLogger('projects.views')

LANGUAGE_EXTENSIONS = {
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".py": "Python",
    ".java": "Java",
    ".php": "PHP",
    ".html": "HTML",
    ".css": "CSS",
    ".cpp": "C++",
    ".c": "C",
    ".go": "Go",
    ".rb": "Ruby",
    ".rs": "Rust",
    ".sh": "Shell",
    ".bash": "Shell",
    ".json": "JSON",
    ".xml": "XML",
    ".yml": "YAML",
    ".yaml": "YAML",
    ".md": "Markdown",
    ".txt": "Text",
    ".toml": "TOML",
    ".ini": "INI",
    ".cfg": "Config",
    ".env": "ENV",
    ".sql": "SQL",
    ".kt": "Kotlin",
    ".swift": "Swift",
    ".scala": "Scala",
    ".r": "R",
    ".dart": "Dart",
    ".vue": "Vue",
    ".svelte": "Svelte",
}

# Maximum file size for content preview (512 KB)
MAX_PREVIEW_BYTES = 512 * 1024

# File extensions that are considered binary / non-previewable
BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".zip", ".tar", ".gz", ".rar", ".7z",
    ".exe", ".dll", ".so", ".dylib", ".bin",
    ".mp3", ".mp4", ".avi", ".mov", ".mkv",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".pyc", ".pyo", ".class",
    ".lock",
}


def _looks_binary(content):
    if b'\x00' in content:
        return True
    if not content:
        return False
    control_bytes = sum(
        byte < 32 and byte not in (9, 10, 12, 13)
        for byte in content
    )
    return control_bytes / len(content) > 0.3


# Create your views here.
class ZipUploadView(APIView):
    """Upload a ZIP file and create a new Project owned by the authenticated user."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ZipUploadSerializer(data=request.data)

        if not serializer.is_valid():
            return Response(
                serializer.errors,
                status=status.HTTP_400_BAD_REQUEST
            )

        zip_file = serializer.validated_data['file']

        # Assign the authenticated user as the owner — never trust a user-id
        # supplied by the frontend.
        project = Project.objects.create(
            name=zip_file.name,
            zip_file=zip_file,
            owner=request.user,
        )
        return Response(
            {
                'id': project.id,
                'name': project.name,
                'zip_file': project.zip_file.url,
                'created_at': project.created_at
            },
            status=status.HTTP_201_CREATED
        )


class GitHubRepositoryUploadView(APIView):
    """
    POST /api/projects/github/

    Downloads a GitHub repository and registers it as a project so the scan
    pipeline can analyse it.

    The repository is archived into a ZIP and stored exactly like an uploaded
    archive, which keeps validation, extraction and scanning on a single code
    path.  The access token is used for the download only — it is never
    persisted, never logged and never returned.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = GitHubRepositorySerializer(data=request.data)

        if not serializer.is_valid():
            return Response(
                {
                    'error': 'The repository details are incomplete.',
                    'details': serializer.errors,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_url = serializer.validated_data.get('url', '')
        token = (serializer.validated_data.get('token') or '').strip()
        branch = (serializer.validated_data.get('branch') or '').strip()

        try:
            parsed = parse_repository_url(raw_url)
        except GitHubRepositoryError as exc:
            return Response({'error': str(exc)}, status=exc.status_code)

        ref = branch or parsed.get('ref')
        owner = parsed['owner']
        repo = parsed['repo']

        workspace = tempfile.mkdtemp(prefix='codeguard_github_')
        try:
            source_dir = os.path.join(workspace, 'source')
            try:
                fetch_repository(owner, repo, source_dir, ref=ref, token=token)
            except GitHubRepositoryError as exc:
                return Response({'error': str(exc)}, status=exc.status_code)
            except Exception:  # noqa: BLE001 — never leak an internal trace
                logger.exception('Fetching the repository %s/%s failed', owner, repo)
                return Response(
                    {'error': f'The repository {owner}/{repo} could not be downloaded.'},
                    status=status.HTTP_502_BAD_GATEWAY,
                )

            archive_path = os.path.join(workspace, f'{repo}.zip')
            try:
                build_source_archive(source_dir, archive_path)
            except GitHubRepositoryError as exc:
                return Response({'error': str(exc)}, status=exc.status_code)

            validation = validate_zip(archive_path)
            if not validation.get('isValid'):
                return Response(
                    {
                        'error': 'The repository could not be prepared for scanning.',
                        'validation': validation,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            with open(archive_path, 'rb') as handle:
                project = Project(owner=request.user, name=repo)
                project.zip_file.save(f'{repo}.zip', File(handle), save=False)
                project.save()

            payload = {
                'id': str(project.id),
                'name': project.name,
                'zip_file': project.zip_file.url,
                'created_at': project.created_at,
                'source': 'github',
                'repository': {
                    'owner': owner,
                    'name': repo,
                    'ref': ref or '',
                },
            }
            # Same shape as ``GET /api/projects/<id>/validate/`` so the UI can
            # treat a repository exactly like an uploaded archive.
            payload.update(validation)
            return Response(payload, status=status.HTTP_201_CREATED)
        finally:
            shutil.rmtree(workspace, ignore_errors=True)


class ProjectListView(ListAPIView):
    """Return only the authenticated user's projects, ordered newest first."""
    serializer_class = ProjectListSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Project.objects.filter(
            owner=self.request.user
        ).order_by('-created_at')


class ProjectValidationView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id):
        # get_object_or_404 scoped to the requesting user — a 404 is returned
        # for projects owned by other users, which prevents information leakage.
        project = get_object_or_404(Project, id=project_id, owner=request.user)
        with local_archive_path(project) as zip_path:
            validation_data = validate_zip(zip_path)
        return Response(validation_data, status=status.HTTP_200_OK)


class ValidateProjectView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id):
        project = get_object_or_404(Project, id=project_id, owner=request.user)

        languages = set()
        file_count = 0
        total_size = 0

        try:
            with local_archive_path(project) as zip_path:
                with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                    for file_info in zip_ref.infolist():
                        if not file_info.is_dir():
                            file_count += 1
                            total_size += file_info.file_size

                            _, ext = os.path.splitext(file_info.filename)
                            ext = ext.lower()

                            if ext in LANGUAGE_EXTENSIONS:
                                languages.add(LANGUAGE_EXTENSIONS[ext])

        except InvalidZipArchive:
            logger.warning('Project archive is missing for project %s', project.pk)
            return Response(
                {"error": "The project archive could not be found."},
                status=status.HTTP_404_NOT_FOUND
            )
        except zipfile.BadZipFile:
            return Response(
                {
                    "isValid": False,
                    "languages": [],
                    "fileCount": 0,
                    "totalSize": 0,
                    "errors": [
                        {
                            "title": "Invalid ZIP",
                            "message": "Uploaded file is not a valid ZIP archive."
                        }
                    ],
                    "warnings": []
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        return Response({
            "isValid": True,
            "languages": list(languages),
            "fileCount": file_count,
            "totalSize": total_size,
            "errors": [],
            "warnings": []
        })


def _normalize_path(raw):
    """Normalise a ZIP entry path to a consistent forward-slash relative path."""
    # Replace Windows separators, collapse duplicates, strip leading slashes
    p = raw.replace('\\', '/')
    p = posixpath.normpath(p).lstrip('/')
    return p


def _requested_file_path(raw):
    """Validate a client path before normalising it for ZIP member lookup."""
    value = raw.replace('\\', '/')
    if (
        '\x00' in value
        or value.startswith('/')
        or re.match(r'^[A-Za-z]:', value)
    ):
        return None, status.HTTP_400_BAD_REQUEST

    if '..' in value.split('/'):
        return None, status.HTTP_403_FORBIDDEN

    normalized = posixpath.normpath(value)
    if normalized in ('', '.', '..') or normalized.startswith('../'):
        return None, status.HTTP_400_BAD_REQUEST

    return normalized, None


class FileTreeView(APIView):
    """
    GET /api/projects/<project_id>/filetree/

    Returns the hierarchical file structure of the uploaded ZIP archive.
    Only the authenticated owner may access this endpoint.

    Response shape:
    {
      "projectId": "<uuid>",
      "projectName": "<str>",
      "files": [
        {
          "path": "src/app.js",          // relative forward-slash path
          "name": "app.js",
          "isFolder": false,
          "language": "JavaScript",
          "size": 1234                    // bytes (files only)
        },
        ...
      ]
    }
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id):
        project = get_object_or_404(Project, id=project_id, owner=request.user)

        try:
            entries_by_path = {}
            with local_archive_path(project) as zip_path:
                with zipfile.ZipFile(zip_path, 'r') as zf:
                    for info in zf.infolist():
                        norm, path_error_status = _requested_file_path(info.filename)
                        if path_error_status:
                            continue
                        if not norm or norm == '.':
                            continue

                        is_dir = info.is_dir()
                        _, ext = os.path.splitext(norm)
                        ext = ext.lower()

                        entries_by_path[norm] = {
                            "path": norm,
                            "name": posixpath.basename(norm),
                            "isFolder": is_dir,
                            "language": LANGUAGE_EXTENSIONS.get(ext, "Unknown") if not is_dir else None,
                            "size": info.file_size if not is_dir else None,
                            "isBinary": ext in BINARY_EXTENSIONS if not is_dir else False,
                        }

            # Sort: folders first, then alphabetically by path
            entries = list(entries_by_path.values())
            entries.sort(key=lambda e: (not e["isFolder"], e["path"].lower()))

            return Response({
                "projectId": str(project.id),
                "projectName": project.name,
                "files": entries,
            })

        except InvalidZipArchive:
            logger.warning('Project archive is missing for project %s', project.pk)
            return Response(
                {"error": "The project archive could not be found."},
                status=status.HTTP_404_NOT_FOUND
            )
        except zipfile.BadZipFile:
            return Response(
                {"error": "The uploaded file is not a valid ZIP archive."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )
        except Exception:
            logger.exception('Could not read file tree for project %s', project.pk)
            return Response(
                {"error": "Could not read the project archive."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class FileContentView(APIView):
    """
    GET /api/projects/<project_id>/file/?path=<relative_path>

    Returns the text content of a single file inside the uploaded ZIP.
    Only the authenticated owner may access this endpoint.

    Query parameters:
      path  — relative path inside the ZIP (forward slashes, no leading slash)

    Response shape:
    {
      "path": "src/app.js",
      "name": "app.js",
      "language": "JavaScript",
      "content": "...",         // file text
      "lines": 42,
      "size": 1234,
      "truncated": false        // true when the file was larger than MAX_PREVIEW_BYTES
    }

    Error codes:
      400  — missing or invalid path parameter
      403  — path traversal detected
      404  — project or file not found
      422  — file is binary or not previewable
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id):
        project = get_object_or_404(Project, id=project_id, owner=request.user)

        raw_path = request.query_params.get('path', '')
        if not raw_path:
            return Response(
                {"error": "The 'path' query parameter is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        norm, path_error_status = _requested_file_path(raw_path)
        if path_error_status:
            message = 'Path traversal detected.' if path_error_status == status.HTTP_403_FORBIDDEN else 'Invalid file path.'
            return Response({"error": message}, status=path_error_status)

        # Check extension
        _, ext = os.path.splitext(norm)
        ext = ext.lower()
        if ext in BINARY_EXTENSIONS:
            return Response(
                {
                    "path": norm,
                    "name": posixpath.basename(norm),
                    "isBinary": True,
                    "error": "Binary files cannot be previewed.",
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )

        try:
            with local_archive_path(project) as zip_path:
                with zipfile.ZipFile(zip_path, 'r') as zf:
                    # Build a normalised name→ZipInfo map to handle path differences
                    name_map = {_normalize_path(info.filename): info for info in zf.infolist()}

                    if norm not in name_map:
                        return Response(
                            {"error": f"File '{norm}' not found in the project."},
                            status=status.HTTP_404_NOT_FOUND
                        )

                    info = name_map[norm]
                    if info.is_dir():
                        return Response(
                            {"error": f"File '{norm}' not found in the project."},
                            status=status.HTTP_404_NOT_FOUND
                        )

                    if info.file_size > MAX_PREVIEW_BYTES:
                        # Read only the first MAX_PREVIEW_BYTES
                        with zf.open(info) as f:
                            raw_bytes = f.read(MAX_PREVIEW_BYTES)
                        truncated = True
                    else:
                        with zf.open(info) as f:
                            raw_bytes = f.read()
                        truncated = False

                    if _looks_binary(raw_bytes):
                        return Response(
                            {
                                "path": norm,
                                "name": posixpath.basename(norm),
                                "isBinary": True,
                                "error": "Binary files cannot be previewed.",
                            },
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY
                        )

                    # Decode — try UTF-8 first, fall back to latin-1
                    try:
                        content = raw_bytes.decode('utf-8')
                    except UnicodeDecodeError:
                        try:
                            content = raw_bytes.decode('latin-1')
                        except Exception:
                            return Response(
                                {
                                    "path": norm,
                                    "name": posixpath.basename(norm),
                                    "isBinary": True,
                                    "error": "File could not be decoded as text.",
                                },
                                status=status.HTTP_422_UNPROCESSABLE_ENTITY
                            )

                    return Response({
                        "path": norm,
                        "name": posixpath.basename(norm),
                        "language": LANGUAGE_EXTENSIONS.get(ext, "Unknown"),
                        "content": content,
                        "lines": content.count('\n') + 1,
                        "size": info.file_size,
                        "truncated": truncated,
                        "isBinary": False,
                    })

        except InvalidZipArchive:
            logger.warning('Project archive is missing for project %s', project.pk)
            return Response(
                {"error": "The project archive could not be found."},
                status=status.HTTP_404_NOT_FOUND
            )
        except zipfile.BadZipFile:
            return Response(
                {"error": "The uploaded file is not a valid ZIP archive."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )
        except Exception:
            logger.exception('Could not read file %s from project %s', norm, project.pk)
            return Response(
                {"error": "Could not read the file from the project archive."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
