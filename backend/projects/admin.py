from django.contrib import admin
from .models import Project

# Register your models here.
@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'owner', 'created_at')
    list_filter = ('owner',)
    search_fields = ('name', 'owner__username', 'owner__email')
    raw_id_fields = ('owner',)
    list_select_related = ('owner',)