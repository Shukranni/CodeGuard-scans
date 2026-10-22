from django.urls import path
from django.conf import settings
from django.conf.urls.static import static
from .views import (
    ZipUploadView,
    GitHubRepositoryUploadView,
    ProjectListView,
    ProjectValidationView,
    ValidateProjectView,
    FileTreeView,
    FileContentView,
)

urlpatterns = [
    path('upload/', ZipUploadView.as_view(), name='zip-upload'),
    path('github/', GitHubRepositoryUploadView.as_view(), name='github-upload'),
    path('', ProjectListView.as_view(), name='project-list'),
    path('<uuid:project_id>/validate/', ValidateProjectView.as_view(), name='project-validate'),
    # Code Explorer APIs
    path('<uuid:project_id>/filetree/', FileTreeView.as_view(), name='project-filetree'),
    path('<uuid:project_id>/file/', FileContentView.as_view(), name='project-file-content'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
