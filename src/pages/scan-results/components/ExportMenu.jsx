/**
 * ExportMenu — the report export formats.
 *
 * Uses the shared `Dropdown` so the menu is keyboard accessible and follows
 * the WAI-ARIA menu-button pattern.
 */
import React from 'react';
import Button from '../../../components/ui/Button';
import Dropdown from '../../../components/ui/Dropdown';

const EXPORT_FORMATS = [
  { id: 'pdf', label: 'PDF report', icon: 'FileText', description: 'Human-readable document' },
  { id: 'json', label: 'JSON report', icon: 'FileJson', description: 'Machine-readable format' },
  { id: 'sarif', label: 'SARIF', icon: 'FileCode', description: 'Static analysis interchange' },
  { id: 'csv', label: 'CSV', icon: 'Table', description: 'Spreadsheet compatible' },
];

const ExportMenu = ({ onExport }) => (
  <Dropdown
    label="Export report"
    items={EXPORT_FORMATS.map((format) => ({
      key: format.id,
      label: format.label,
      description: format.description,
      icon: format.icon,
      onSelect: () => onExport(format.id),
    }))}
    trigger={
      <Button variant="outline" iconName="Download" iconPosition="left">
        Export
      </Button>
    }
  />
);

export default ExportMenu;
