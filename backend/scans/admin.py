from django.contrib import admin
from .models import Scan, WorkerHeartbeat

@admin.register(Scan)
class ScanAdmin(admin.ModelAdmin):
    list_display = ('id', 'project', 'status', 'stage', 'progress', 'worker_id', 'started_at', 'completed_at', 'scanners')
    list_filter = ('status',)
    search_fields = ('project__name',)


@admin.register(WorkerHeartbeat)
class WorkerHeartbeatAdmin(admin.ModelAdmin):
    list_display = ('name', 'worker_id', 'last_seen')
