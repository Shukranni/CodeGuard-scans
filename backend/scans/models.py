from django.db import models
from django.utils import timezone
from projects.models import Project

# Create your models here.
class Scan(models.Model):
    """
    A security scan request and its lifecycle.

    Lifecycle:
        queued  → accepted, waiting for a scan worker
        preparing → worker claimed the job, validating/extracting the archive
        running → scanners are executing
        completed / completed_with_warnings → terminal, results persisted
        failed → terminal, error recorded
        resolved → terminal, legacy triage state
        pending → legacy value kept only for rows created before this change
    """
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('queued', 'Queued'),
        ('preparing', 'Preparing'),
        ('running', 'Running'),
        ('completed', 'Completed'),
        ('completed_with_warnings', 'Completed with warnings'),
        ('failed', 'Failed'),
        ('resolved', 'Resolved'),
    ]

    # Statuses that mean "the job still needs to run / is running".
    ACTIVE_STATUSES = ('pending', 'queued', 'preparing', 'running')
    # Statuses that mean "no further processing will happen".
    TERMINAL_STATUSES = ('completed', 'completed_with_warnings', 'failed', 'resolved')

    project = models.ForeignKey(
        Project, 
        on_delete=models.CASCADE
    )
    scanners = models.JSONField(
        default=list,
        blank=True
    )
    result = models.JSONField(
        null=True,
        blank=True
    )
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default='queued')
    # Fine-grained step inside the current status (e.g. 'extracting',
    # 'running:semgrep').  Useful for debugging and for precise progress UI.
    stage = models.CharField(max_length=64, default='queued', blank=True)
    # Real progress 0-100 derived from completed scanners — never fabricated.
    progress = models.IntegerField(default=0)
    # Technical failure detail for debugging (sanitised before it is exposed
    # through the API).
    error = models.TextField(blank=True, default='')
    # Which worker process claimed this scan; prevents two workers from
    # running the same scan concurrently.
    worker_id = models.CharField(max_length=120, blank=True, default='')
    dismissed_findings = models.JSONField(
        default=list,
        blank=True
    )
    started_at = models.DateTimeField(default=timezone.now)
    completed_at = models.DateTimeField(null=True, blank=True, default=None)
    # Heartbeat used to detect interrupted/stale jobs.  Updated explicitly
    # by ``QuerySet.update()`` calls as well as by ``save()``.
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-started_at']

    @property
    def is_terminal(self):
        return self.status in self.TERMINAL_STATUSES

    def __str__(self):
        return f"Scan {self.id} - {self.project.name}"


class WorkerHeartbeat(models.Model):
    """
    Liveness record for the background scan worker.

    The worker refreshes ``last_seen`` on every poll cycle so the API can
    tell users "the scan is queued but no worker is online" instead of
    leaving them on an endless setup screen.
    """
    name = models.CharField(max_length=100, unique=True, default='scan-worker')
    last_seen = models.DateTimeField(default=timezone.now)
    worker_id = models.CharField(max_length=120, blank=True, default='')

    def __str__(self):
        return f"Worker {self.name} ({self.worker_id})"

    @classmethod
    def beat(cls, worker_id, name='scan-worker'):
        obj, _ = cls.objects.update_or_create(
            name=name,
            defaults={'last_seen': timezone.now(), 'worker_id': worker_id},
        )
        return obj

    @classmethod
    def is_online(cls, name='scan-worker', max_age_seconds=30):
        from datetime import timedelta
        obj = cls.objects.filter(name=name).first()
        if obj is None:
            return False
        return (timezone.now() - obj.last_seen) <= timedelta(seconds=max_age_seconds)

    @classmethod
    def clear(cls, name='scan-worker', worker_id=None):
        """
        Remove the heartbeat row so the worker counts as offline.

        ``worker_id`` restricts the removal to the row owned by that worker —
        a worker that is shutting down must never delete the heartbeat of a
        worker that is still running on another host.
        """
        queryset = cls.objects.filter(name=name)
        if worker_id is not None:
            queryset = queryset.filter(worker_id=worker_id)
        queryset.delete()
