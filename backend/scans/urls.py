from .views import (
    StartScanView,
    ScanListView,
    ScanDetailView,
    ScanStatusView,
    ScannerAvailabilityView,
    ArchiveDownloadView,
    ResolveScanView,
    DismissFindingView,
    DashboardOverviewView,
    FindingDetailView,
    FindingExplanationView,
)
from django.urls import path, re_path

urlpatterns = [
    path('', ScanListView.as_view(), name='scan-list'),
    path('overview/', DashboardOverviewView.as_view(), name='dashboard-overview'),
    path('scanners/', ScannerAvailabilityView.as_view(), name='scanner-availability'),
    # Signed, short-lived archive hand-off for the GitHub Actions runner.
    # Declared before the ``<int:pk>/`` routes for readability (it could
    # not match them anyway — "archive" is not an integer).
    path('archive/', ArchiveDownloadView.as_view(), name='archive-download'),
    path('start/', StartScanView.as_view(), name='start-scan'),
    path('<int:pk>/', ScanDetailView.as_view(), name='scan-detail'),
    path('<int:pk>/status/', ScanStatusView.as_view(), name='scan-status'),
    path('<int:pk>/resolve/', ResolveScanView.as_view(), name='scan-resolve'),
    path('<int:pk>/dismiss/', DismissFindingView.as_view(), name='scan-dismiss'),
    # The finding id may contain a "/" (npm package names such as
    # "dep_@babel/core"), so it is captured with a non-greedy pattern.  The
    # explain route is declared first so that ".../explain/" is never swallowed
    # by the plain finding route.
    re_path(
        r'^(?P<pk>\d+)/findings/(?P<finding_id>.+?)/explain/$',
        FindingExplanationView.as_view(),
        name='finding-explanation',
    ),
    re_path(
        r'^(?P<pk>\d+)/findings/(?P<finding_id>.+?)/$',
        FindingDetailView.as_view(),
        name='finding-detail',
    ),
]
