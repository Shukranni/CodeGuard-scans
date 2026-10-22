/**
 * ScannerSelection — step 2 of the new scan wizard.
 *
 * The whole card is a single native checkbox, so clicking anywhere on it
 * toggles the scanner exactly once and the control keeps working from the
 * keyboard.
 */
import React from 'react';
import Icon from '../../../components/AppIcon';
import { cn } from '../../../utils/cn';

const SCANNERS = [
  {
    id: 'semgrep',
    name: 'Semgrep',
    icon: 'Shield',
    description: 'Static code analysis with OWASP Top 10 aligned rules.',
    features: ['Pattern matching', 'Custom rules', 'Multi-language support'],
  },
  {
    id: 'gitleaks',
    name: 'GitLeaks',
    icon: 'Key',
    description: 'Secret detection with entropy scoring and historical leak detection.',
    features: ['API keys', 'Passwords', 'Tokens', 'Certificates'],
  },
  {
    id: 'dependency',
    name: 'Dependency scanner',
    icon: 'Package',
    description: 'Vulnerability assessment using pip-audit and OSV.dev with CVE mapping.',
    features: ['CVE detection', 'Transitive analysis', 'Freshness scoring'],
  },
];

const ScannerSelection = ({ selectedScanners, onScannerToggle }) => {
  const selected = selectedScanners || [];

  return (
    <section aria-label="Security scanners">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">Select security scanners</h3>
        <p className="text-sm text-muted-foreground">
          {selected.length} of {SCANNERS.length} selected
        </p>
      </div>

      <fieldset className="mt-3 space-y-3">
        <legend className="sr-only">Security scanners to run</legend>

        {SCANNERS.map((scanner) => {
          const isSelected = selected.includes(scanner.id);

          return (
            <label
              key={scanner.id}
              className={cn(
                'block cursor-pointer rounded-xl border p-4 transition-colors duration-150 md:p-5',
                'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
                isSelected
                  ? 'border-primary/50 bg-primary/5'
                  : 'border-border bg-card hover:border-primary/30',
              )}
            >
              <input
                type="checkbox"
                className="peer sr-only"
                checked={isSelected}
                onChange={() => onScannerToggle(scanner.id)}
              />

              <div className="flex items-start gap-3.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                    'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background',
                  )}
                >
                  {isSelected ? <Icon name="Check" size={13} strokeWidth={3} /> : null}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                        isSelected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      <Icon name={scanner.icon} size={17} aria-hidden="true" />
                    </span>
                    <span className="text-base font-semibold text-foreground">{scanner.name}</span>
                    {isSelected ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        Enabled
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-2 text-sm text-muted-foreground">{scanner.description}</p>

                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {scanner.features.map((feature) => (
                      <li
                        key={feature}
                        className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </label>
          );
        })}
      </fieldset>
    </section>
  );
};

export default ScannerSelection;
