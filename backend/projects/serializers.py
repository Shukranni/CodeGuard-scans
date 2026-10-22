from rest_framework import serializers
from .models import Project

class ZipUploadSerializer(serializers.Serializer):
    """
    Used ONLY for uploading ZIP files.
    Accepts multipart/form-data with a `file` field.
    """
    file = serializers.FileField()

    def validate_zip_file(self, value):
        if not value.name.endswith('.zip'):
            raise serializers.ValidationError('Only ZIP files are allowed.')

        if value.size > 100 * 1024 * 1024:  # Limit file size to 100MB
            raise serializers.ValidationError('File size must be under 100MB.')
        return value

class GitHubRepositorySerializer(serializers.Serializer):
    """
    Validates the payload of the "connect a GitHub repository" request.

    The access token is ``write_only`` so it can never be echoed back through
    the API, and it is never persisted — it is only used while the repository
    is being downloaded.
    """
    url = serializers.CharField(max_length=500)
    token = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True,
        allow_null=True,
        write_only=True,
        trim_whitespace=True,
    )
    branch = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
        allow_null=True,
        trim_whitespace=True,
    )


class ProjectListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = ['id', 'name', 'zip_file', 'created_at', 'owner']
        read_only_fields = ['id', 'created_at', 'owner']