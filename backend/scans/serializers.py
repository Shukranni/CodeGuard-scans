from rest_framework import serializers
from .models import Scan
from .services.findings import summarize_scan
from .services.scan_worker import public_error


class ScanSerializer(serializers.ModelSerializer):
    project_name = serializers.ReadOnlyField(source='project.name')
    # Server paths are scrubbed before the stored error detail is exposed.
    error = serializers.SerializerMethodField()
    is_terminal = serializers.BooleanField(read_only=True)
    # Severity counts and the risk score derived from the stored scanner
    # output.  The UI shows them as they are — it never recomputes them.
    summary = serializers.SerializerMethodField()

    class Meta:
        model = Scan
        fields = [
            'id',
            'project',
            'project_name',
            'scanners',
            'result',
            'summary',
            'status',
            'stage',
            'progress',
            'error',
            'is_terminal',
            'dismissed_findings',
            'started_at',
            'completed_at',
            'updated_at',
        ]

        read_only_fields = [
            'started_at',
            'completed_at',
            'updated_at',
            'stage',
            'progress',
            'is_terminal',
            'summary',
        ]

    def get_error(self, obj):
        return public_error(obj.error)

    def get_summary(self, obj):
        return summarize_scan(obj)
