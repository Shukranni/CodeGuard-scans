"""
Short-lived signed links to a project's uploaded archive.

The GitHub Actions runner must fetch the ZIP a scan is about to analyse,
but that archive belongs to a user and normally sits behind authentication.
Instead of handing out credentials, the worker mints a *signed token*
(Django's cryptographic signing, keyed with ``DJANGO_SECRET_KEY``): the API
endpoint can verify it without any shared state, and it stops working
after ``CODEGUARD_ARCHIVE_TOKEN_MAX_AGE`` seconds (default: 15 minutes).

The token is a single opaque query parameter, safe to pass to GitHub as a
workflow input — anyone who intercepts it can read exactly one project
archive, and only until the token expires.
"""
import os
from urllib.parse import quote

from django.core import signing
from django.core.exceptions import ValidationError

from projects.models import Project

SALT = 'codeguard.archive-download'
API_PATH = '/api/scans/archive/'
DEFAULT_MAX_AGE_SECONDS = 900


def max_age_seconds():
    """How long an issued link stays valid (seconds)."""
    try:
        return int(os.environ.get('CODEGUARD_ARCHIVE_TOKEN_MAX_AGE', DEFAULT_MAX_AGE_SECONDS))
    except (TypeError, ValueError):
        return DEFAULT_MAX_AGE_SECONDS


def build_archive_url(project):
    """
    Absolute signed URL for ``project``'s archive.

    Returns ``None`` when the public base URL of this API is unknown
    (``CODEGUARD_PUBLIC_API_BASE`` unset) — callers then skip remote
    scanning entirely instead of generating a link the runner cannot reach.
    """
    if project is None:
        return None
    base = (os.environ.get('CODEGUARD_PUBLIC_API_BASE') or '').strip().rstrip('/')
    if not base:
        return None
    # The token is JSON under the hood, so the (UUID) primary key goes in
    # as its string form.
    token = signing.dumps({'project': str(project.pk)}, salt=SALT)
    return f'{base}{API_PATH}?token={quote(token, safe="")}'


def resolve_project(token):
    """
    Return the Project a signed token points at, or ``None`` when the token
    is absent, malformed, tampered with or older than the max age.
    """
    if not token:
        return None
    try:
        data = signing.loads(token, salt=SALT, max_age=max_age_seconds())
        project_pk = data.get('project') if isinstance(data, dict) else None
        if project_pk is None:
            return None
        # The string form tolerates both UUID and integer primary keys;
        # an unparseable one is simply "no such project".
        return Project.objects.filter(pk=project_pk).first()
    except (signing.BadSignature, ValidationError, ValueError, TypeError):
        return None


__all__ = [
    'API_PATH',
    'DEFAULT_MAX_AGE_SECONDS',
    'SALT',
    'build_archive_url',
    'max_age_seconds',
    'resolve_project',
]
