/**
 * FileTreePanel — project file browser with vulnerability markers.
 */
import React, { useState, useMemo, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Input from '../../../components/ui/Input';
import { SeverityDot } from '../../../components/ui/SeverityBadge';
import { Skeleton } from '../../../components/ui/Skeleton';
import { cn } from '../../../utils/cn';

// Normalise paths consistently (same logic as backend)
const normalizePath = (p) =>
  (p || '')
    .replace(/\\/g, '/')
    .replace(/^[A-Za-z]:\//, '')
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/');

const SEVERITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };

const FileTreePanel = ({
  files = [],
  loading,
  error,
  selectedFile,
  onFileSelect,
  findings = [],
  revealFilePath,
  className,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState(new Set(['root']));
  const [showVulnerabilitiesOnly, setShowVulnerabilitiesOnly] = useState(false);
  const [fileTypeFilter, setFileTypeFilter] = useState('all');

  useEffect(() => {
    if (!revealFilePath) return;
    const parts = normalizePath(revealFilePath).split('/');
    if (parts.length < 2) return;

    setExpandedFolders((prev) => {
      const next = new Set(prev);
      let folderPath = '';
      parts.slice(0, -1).forEach((part, index) => {
        folderPath = index === 0 ? part : `${folderPath}/${part}`;
        next.add(folderPath);
      });
      return next;
    });
  }, [revealFilePath]);

  // Build a findings map keyed by normalised file path
  const findingsByFile = useMemo(() => {
    const map = {};
    findings.forEach((f) => {
      const path = f.resolvedPath;
      if (!path) return;
      const key = normalizePath(path);
      if (!map[key]) map[key] = [];
      map[key].push(f);
    });
    return map;
  }, [findings]);

  const getFileFindings = (filePath) => findingsByFile[normalizePath(filePath)] || [];

  const getHighestSeverity = (filePath) => {
    const fileFindings = getFileFindings(filePath);
    if (fileFindings.length === 0) return null;
    return fileFindings.reduce((highest, f) => {
      const cur = SEVERITY_ORDER[f.severity?.toLowerCase()] || 0;
      const prev = SEVERITY_ORDER[highest?.toLowerCase()] || 0;
      return cur > prev ? f.severity : highest;
    }, fileFindings[0].severity);
  };

  const getFileIcon = (fileName, isFolder, isBinary) => {
    if (isFolder) return 'Folder';
    if (isBinary) return 'FileX2';
    const ext = fileName?.split('.').pop()?.toLowerCase();
    const iconMap = {
      js: 'FileCode',
      jsx: 'FileCode',
      ts: 'FileCode',
      tsx: 'FileCode',
      py: 'FileCode',
      java: 'FileCode',
      go: 'FileCode',
      php: 'FileCode',
      rb: 'FileCode',
      rs: 'FileCode',
      c: 'FileCode',
      cpp: 'FileCode',
      kt: 'FileCode',
      swift: 'FileCode',
      scala: 'FileCode',
      dart: 'FileCode',
      vue: 'FileCode',
      svelte: 'FileCode',
      sh: 'Terminal',
      bash: 'Terminal',
      json: 'FileJson',
      md: 'FileText',
      txt: 'FileText',
      yml: 'Settings',
      yaml: 'Settings',
      toml: 'Settings',
      ini: 'Settings',
      cfg: 'Settings',
      xml: 'FileCode',
      html: 'FileCode',
      css: 'Palette',
      scss: 'Palette',
      sql: 'Database',
      env: 'Lock',
    };
    return iconMap[ext] || 'File';
  };

  const toggleFolder = (path) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // Unique file-type extension list
  const fileTypes = useMemo(() => {
    const types = new Set(['all']);
    files.forEach((f) => {
      if (!f.isFolder) {
        const ext = f.path?.split('.').pop()?.toLowerCase();
        if (ext) types.add(ext);
      }
    });
    return Array.from(types);
  }, [files]);

  // Filter files
  const filteredFiles = useMemo(() => {
    const search = searchQuery.toLowerCase();
    const matchesFile = (file) => {
      const matchesSearch = normalizePath(file.path)
        .toLowerCase()
        .includes(search);
      const hasFindings = getFileFindings(file.path).length > 0;
      let matchesTypeFilter = true;
      if (fileTypeFilter !== 'all') {
        const ext = file.path?.split('.').pop()?.toLowerCase();
        matchesTypeFilter = ext === fileTypeFilter;
      }
      return matchesSearch && (!showVulnerabilitiesOnly || hasFindings) && matchesTypeFilter;
    };

    if (!search && !showVulnerabilitiesOnly && fileTypeFilter === 'all') return files;

    const matchingFiles = files.filter((file) => !file.isFolder && matchesFile(file));
    const visiblePaths = new Set();
    matchingFiles.forEach((file) => {
      const parts = normalizePath(file.path).split('/');
      parts.forEach((_, index) => {
        visiblePaths.add(parts.slice(0, index + 1).join('/'));
      });
    });

    files.forEach((file) => {
      if (!file.isFolder) return;
      const folderPath = normalizePath(file.path);
      if (!showVulnerabilitiesOnly && folderPath.toLowerCase().includes(search)) {
        visiblePaths.add(folderPath);
      }
    });

    return files.filter((file) => visiblePaths.has(normalizePath(file.path)));
  }, [files, searchQuery, showVulnerabilitiesOnly, fileTypeFilter, findingsByFile]);

  // Build the hierarchical tree from a flat list
  const buildTree = (flatFiles) => {
    const root = { name: 'root', path: 'root', isFolder: true, children: [] };
    const map = { root };

    const sorted = [...flatFiles].sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.path.localeCompare(b.path);
    });

    sorted.forEach((file) => {
      const parts = file.path.split('/');
      let currentPath = 'root';

      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        const fullPath = parts.slice(0, index + 1).join('/');

        if (!map[fullPath]) {
          const node = {
            name: part,
            path: fullPath,
            isFolder: !isLast,
            isBinary: isLast ? file.isBinary : false,
            language: isLast ? file.language : null,
            size: isLast ? file.size : null,
            children: [],
          };
          map[fullPath] = node;
          if (map[currentPath]) {
            map[currentPath].children.push(node);
          }
        } else if (isLast) {
          map[fullPath].isFolder = file.isFolder;
          map[fullPath].isBinary = file.isBinary;
          map[fullPath].language = file.language;
          map[fullPath].size = file.size;
        }

        currentPath = fullPath;
      });
    });

    return root.children;
  };

  const tree = useMemo(() => buildTree(filteredFiles), [filteredFiles]);

  const renderFileTree = (items, level = 0) => {
    return items.map((file) => {
      const isExpanded = expandedFolders.has(file.path);
      const fileFindings = getFileFindings(file.path);
      const vulnCount = fileFindings.length;
      const severity = getHighestSeverity(file.path);
      const isSelected = selectedFile?.path === file.path;
      const isFolder = file.isFolder;

      return (
        <div key={file.path} role="treeitem" aria-expanded={isFolder ? isExpanded : undefined}>
          <button
            onClick={() => {
              if (isFolder) {
                toggleFolder(file.path);
              } else {
                onFileSelect(file);
              }
            }}
            className={cn(
              'group flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50',
            )}
            style={{ paddingLeft: `${level * 16 + 12}px` }}
            title={file.path}
            type="button"
            aria-selected={!isFolder ? isSelected : undefined}
          >
            {isFolder ? (
              <Icon
                name={isExpanded ? 'ChevronDown' : 'ChevronRight'}
                size={14}
                className="flex-shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            ) : (
              <span className="w-3.5 flex-shrink-0" aria-hidden="true" />
            )}
            <Icon
              name={getFileIcon(file.name, isFolder, file.isBinary)}
              size={15}
              className="flex-shrink-0"
              color={
                isSelected
                  ? 'var(--color-primary)'
                  : isFolder
                  ? 'var(--color-accent)'
                  : 'var(--color-muted-foreground)'
              }
              aria-hidden="true"
            />
            <span
              className={cn(
                'flex-1 truncate font-mono text-xs',
                file.isBinary && 'text-muted-foreground',
              )}
            >
              {file.name}
            </span>
            {vulnCount > 0 && severity ? (
              <span className="flex flex-shrink-0 items-center gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-[11px]">
                <SeverityDot severity={severity} />
                <span className="text-muted-foreground">{vulnCount}</span>
              </span>
            ) : null}
          </button>
          {isFolder && isExpanded && file.children?.length > 0 ? (
            <div role="group">{renderFileTree(file.children, level + 1)}</div>
          ) : null}
        </div>
      );
    });
  };

  // ── Stats ──
  const fileCount = files.filter((f) => !f.isFolder).length;
  const filesWithIssues = new Set(
    findings
      .map((f) => f.resolvedPath)
      .filter(Boolean)
      .map(normalizePath),
  ).size;

  // ── Loading state ──
  if (loading) {
    return (
      <div className={cn('flex h-full flex-col rounded-xl border border-border bg-card', className)}>
        <div className="flex items-center justify-between border-b border-border p-4">
          <Skeleton className="h-5 w-28" />
          <div className="flex items-center gap-1">
            <Skeleton className="h-7 w-7 rounded-md" />
            <Skeleton className="h-7 w-7 rounded-md" />
          </div>
        </div>
        <div className="space-y-2 p-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-6 w-24" />
        </div>
        <div className="flex-1 space-y-1.5 px-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <Skeleton key={idx} className="h-7 w-full" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-border p-4">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div
        className={cn(
          'flex h-full flex-col items-center justify-center rounded-xl border border-border bg-card p-6 text-center',
          className,
        )}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-error/10 text-error">
          <Icon name="AlertCircle" size={24} aria-hidden="true" />
        </span>
        <p className="mt-3 text-sm font-medium text-foreground">Failed to load files</p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col rounded-xl border border-border bg-card', className)}>
      {/* Header */}
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Project files</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setExpandedFolders(new Set(['root']))}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Collapse all"
              type="button"
            >
              <Icon name="FoldVertical" size={15} aria-hidden="true" />
            </button>
            <button
              onClick={() => {
                const allFolders = new Set(['root']);
                files.forEach((f) => {
                  if (f.isFolder) allFolders.add(f.path);
                });
                files.forEach((f) => {
                  const parts = f.path.split('/');
                  let p = '';
                  parts.forEach((part, i) => {
                    p = i === 0 ? part : `${p}/${part}`;
                    allFolders.add(p);
                  });
                });
                setExpandedFolders(allFolders);
              }}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Expand all"
              type="button"
            >
              <Icon name="UnfoldVertical" size={15} aria-hidden="true" />
            </button>
          </div>
        </div>

        <Input
          type="search"
          placeholder="Search files…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="text-sm"
        />

        <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showVulnerabilitiesOnly}
            onChange={(e) => setShowVulnerabilitiesOnly(e.target.checked)}
            className="rounded border-border text-primary focus:ring-ring"
          />
          Vulnerable files only
        </label>

        {fileTypes.length > 2 ? (
          <div className="flex flex-wrap gap-1.5">
            {fileTypes.map((type) => (
              <button
                key={type}
                onClick={() => setFileTypeFilter(type)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  fileTypeFilter === type
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                type="button"
              >
                {type === 'all' ? 'All' : `.${type}`}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto" role="tree" aria-label="Project files">
        {tree.length > 0 ? (
          renderFileTree(tree)
        ) : files.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <Icon name="FolderOpen" size={40} className="mb-3 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">This project has no files</p>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <Icon name="Search" size={40} className="mb-3 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">No files match your search</p>
            <button
              onClick={() => {
                setSearchQuery('');
                setShowVulnerabilitiesOnly(false);
                setFileTypeFilter('all');
              }}
              className="mt-2 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              type="button"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Footer stats */}
      <div className="border-t border-border p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">Total files</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{fileCount}</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">With issues</div>
            <div
              className={cn(
                'mt-1 text-lg font-semibold',
                filesWithIssues > 0 ? 'text-high' : 'text-foreground',
              )}
            >
              {filesWithIssues}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileTreePanel;
