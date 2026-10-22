from django.db import models
import uuid
from django.utils import timezone
from django.conf import settings


# Create your models here.
class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # owner is nullable so that pre-existing legacy records are preserved as
    # unowned rather than being assigned to any particular user.
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='projects',
    )
    name = models.CharField(max_length=255)
    zip_file = models.FileField(upload_to='uploads/')
    created_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return self.name