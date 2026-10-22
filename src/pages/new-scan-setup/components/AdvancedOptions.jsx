/**
 * AdvancedOptions — optional preferences for a scan.
 *
 * The section is a disclosure: it stays collapsed until it is opened, and the
 * trigger announces its state with `aria-expanded`.
 */
import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Input from '../../../components/ui/Input';
import Tooltip from '../../../components/ui/Tooltip';
import { Checkbox } from '../../../components/ui/Checkbox';
import { cn } from '../../../utils/cn';

const OWASP_CATEGORIES = [
  { id: 'a01', label: 'A01:2021 - Broken Access Control' },
  { id: 'a02', label: 'A02:2021 - Cryptographic Failures' },
  { id: 'a03', label: 'A03:2021 - Injection' },
  { id: 'a04', label: 'A04:2021 - Insecure Design' },
  { id: 'a05', label: 'A05:2021 - Security Misconfiguration' },
  { id: 'a06', label: 'A06:2021 - Vulnerable Components' },
  { id: 'a07', label: 'A07:2021 - Authentication Failures' },
  { id: 'a08', label: 'A08:2021 - Software and Data Integrity' },
  { id: 'a09', label: 'A09:2021 - Security Logging Failures' },
  { id: 'a10', label: 'A10:2021 - Server-Side Request Forgery' },
];

const AdvancedOptions = ({ options, onOptionsChange }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const panelId = 'advanced-options-panel';

  const selectedOwasp = options?.owaspCategories || [];
  const allSelected = selectedOwasp.length === OWASP_CATEGORIES.length;

  const handlePathExclusionChange = (value) => {
    onOptionsChange({ ...options, pathExclusions: value });
  };

  const handleTimeoutChange = (value) => {
    onOptionsChange({ ...options, scanTimeout: parseInt(value, 10) || 30 });
  };

  const handleOwaspToggle = (categoryId) => {
    const updated = selectedOwasp.includes(categoryId)
      ? selectedOwasp.filter((id) => id !== categoryId)
      : [...selectedOwasp, categoryId];
    onOptionsChange({ ...options, owaspCategories: updated });
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        className={cn(
          'flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors md:px-5',
          'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        )}
      >
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon name="SlidersHorizontal" size={17} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-base font-semibold text-foreground">Advanced options</span>
            <span className="block text-sm text-muted-foreground">
              Optional preferences recorded with this scan.
            </span>
          </span>
        </span>
        <Icon
          name={isExpanded ? 'ChevronUp' : 'ChevronDown'}
          size={18}
          className="shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </button>

      {isExpanded ? (
        <div id={panelId} className="space-y-6 border-t border-border px-4 py-5 md:px-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="path-exclusions"
                className="mb-1.5 flex items-center gap-2 text-sm font-medium text-foreground"
              >
                Path exclusion patterns
                <Tooltip content="Exclude files or directories from scanning using glob patterns, for example **/node_modules/** or **/*.test.js.">
                  <button
                    type="button"
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="About path exclusion patterns"
                  >
                    <Icon name="Info" size={14} aria-hidden="true" />
                  </button>
                </Tooltip>
              </label>
              <Input
                id="path-exclusions"
                type="text"
                placeholder="**/node_modules/**, **/test/**, **/*.min.js"
                value={options?.pathExclusions || ''}
                onChange={(event) => handlePathExclusionChange(event.target.value)}
                description="Comma-separated glob patterns."
              />
            </div>

            <div>
              <label
                htmlFor="scan-timeout"
                className="mb-1.5 flex items-center gap-2 text-sm font-medium text-foreground"
              >
                Scan timeout (minutes)
                <Tooltip content="Maximum time allowed for the scan to complete. 30-60 minutes is recommended for large projects.">
                  <button
                    type="button"
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="About the scan timeout"
                  >
                    <Icon name="Info" size={14} aria-hidden="true" />
                  </button>
                </Tooltip>
              </label>
              <Input
                id="scan-timeout"
                type="number"
                min="5"
                max="120"
                placeholder="30"
                value={options?.scanTimeout ?? 30}
                onChange={(event) => handleTimeoutChange(event.target.value)}
                description="Range: 5-120 minutes."
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-medium text-foreground">OWASP Top 10 categories</h4>
              <button
                type="button"
                onClick={() =>
                  onOptionsChange({
                    ...options,
                    owaspCategories: allSelected ? [] : OWASP_CATEGORIES.map((c) => c.id),
                  })
                }
                className="rounded text-xs font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            <div className="mt-3 grid max-h-64 grid-cols-1 gap-2 overflow-y-auto pr-1">
              {OWASP_CATEGORIES.map((category) => (
                <Checkbox
                  key={category.id}
                  label={category.label}
                  checked={selectedOwasp.includes(category.id)}
                  onChange={() => handleOwaspToggle(category.id)}
                  size="sm"
                />
              ))}
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <Checkbox
              label="Enable verbose logging"
              description="Include detailed scan logs in the report."
              checked={options?.verboseLogging || false}
              onChange={(event) =>
                onOptionsChange({ ...options, verboseLogging: event.target.checked })
              }
            />
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default AdvancedOptions;
