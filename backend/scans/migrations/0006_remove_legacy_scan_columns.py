from django.db import migrations


LEGACY_COLUMNS = (
    'current_stage',
    'error_message',
    'files_processed',
    'findings_count',
    'scanner_statuses',
    'stage_message',
    'total_files',
)


def remove_legacy_scan_columns(apps, schema_editor):
    connection = schema_editor.connection
    table_name = 'scans_scan'
    existing_columns = {
        column.name
        for column in connection.introspection.get_table_description(
            connection.cursor(),
            table_name,
        )
    }

    for column_name in LEGACY_COLUMNS:
        if column_name in existing_columns:
            schema_editor.execute(
                'ALTER TABLE {} DROP COLUMN {}'.format(
                    schema_editor.quote_name(table_name),
                    schema_editor.quote_name(column_name),
                )
            )


class Migration(migrations.Migration):
    dependencies = [
        ('scans', '0005_workerheartbeat_alter_scan_options_scan_error_and_more'),
    ]

    operations = [
        migrations.RunPython(
            remove_legacy_scan_columns,
        ),
    ]
