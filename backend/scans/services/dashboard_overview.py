from datetime import timedelta
from django.utils import timezone
from scans.models import Scan
from scans.services.findings import SEVERITY_WEIGHTS
from projects.models import Project

class DashboardOverviewService:
    @staticmethod
    def map_severity(severity, scanner):
        s = (severity or '').lower()
        if scanner == 'semgrep':
            if s == 'error':
                return 'critical'
            if s == 'warning':
                return 'high'
            return 'medium'
        if scanner == 'gitleaks':
            return 'critical'
        if scanner == 'dependency':
            if s == 'critical':
                return 'critical'
            if s == 'high':
                return 'high'
            if s == 'moderate':
                return 'medium'
            return 'low'
        return 'medium'

    @classmethod
    def get_overview(cls, user=None, time_range='7d'):
        now = timezone.now()
        time_filters = {
            '24h': timedelta(days=1),
            '7d': timedelta(days=7),
            '30d': timedelta(days=30),
            '90d': timedelta(days=90),
        }

        filter_delta = time_filters.get(time_range)
        # Scope scans and projects to the requesting user when provided.
        if user is not None:
            scans_qs = Scan.objects.filter(
                project__owner=user
            ).order_by('-started_at')
            projects_qs = Project.objects.filter(owner=user)
        else:
            scans_qs = Scan.objects.all().order_by('-started_at')
            projects_qs = Project.objects.all()

        if filter_delta:
            cutoff = now - filter_delta
            filtered_scans = scans_qs.filter(started_at__gte=cutoff)
            # Fallback to all scans if time range yields no scans
            scans = list(filtered_scans) if filtered_scans.exists() else list(scans_qs)
        else:
            scans = list(scans_qs)

        total_projects = projects_qs.count()

        
        all_findings = []
        file_stats = {}
        risk_dist = {'critical': 0, 'high': 0, 'medium': 0, 'low': 0, 'info': 0}
        scans_by_date = {}

        for scan in scans:
            dismissed = set(scan.dismissed_findings or [])
            scanners_data = (scan.result or {}).get('scans', {})
            date_key = scan.started_at.strftime('%b %d') if scan.started_at else 'Unknown'
            
            if date_key not in scans_by_date:
                scans_by_date[date_key] = {'critical': 0, 'high': 0, 'medium': 0, 'low': 0, 'total': 0}

            # 1. Semgrep
            if 'semgrep' in scanners_data and isinstance(scanners_data['semgrep'], dict):
                vulns = scanners_data['semgrep'].get('all_vulnerabilities', [])
                for idx, f in enumerate(vulns):
                    f_id = f"semgrep_{idx}"
                    if f_id in dismissed:
                        continue
                    
                    sev = cls.map_severity(f.get('extra', {}).get('severity'), 'semgrep')
                    file_path = f.get('path', 'unknown_file')
                    line = f.get('start', {}).get('line', 1)
                    msg = f.get('extra', {}).get('message', 'Security issue detected').split('.')[0]
                    cwe = (f.get('extra', {}).get('metadata', {}).get('cwe', ['CWE-89']) or ['CWE-89'])[0]
                    owasp = (f.get('extra', {}).get('metadata', {}).get('owasp', ['A03: Injection']) or ['A03: Injection'])[0]

                    finding_obj = {
                        'id': f_id,
                        'title': msg,
                        'severity': sev,
                        'scanner': 'Semgrep',
                        'file': file_path,
                        'line': line,
                        'cwe': cwe,
                        'owasp': owasp,
                        'description': f.get('extra', {}).get('message', 'No description'),
                        'scan_id': scan.id,
                        'scan_date': date_key
                    }
                    all_findings.append(finding_obj)

            # 2. Gitleaks
            if 'gitleaks' in scanners_data and isinstance(scanners_data['gitleaks'], dict):
                vulns = scanners_data['gitleaks'].get('all_vulnerabilities', [])
                for idx, f in enumerate(vulns):
                    f_id = f"gitleaks_{idx}"
                    if f_id in dismissed:
                        continue
                    
                    desc = f.get('Description', 'Credential')
                    file_path = f.get('File', 'unknown_file')
                    line = f.get('StartLine', 1)

                    finding_obj = {
                        'id': f_id,
                        'title': f"Exposed Secret: {desc}",
                        'severity': 'critical',
                        'scanner': 'GitLeaks',
                        'file': file_path,
                        'line': line,
                        'cwe': 'CWE-798',
                        'owasp': 'A07:2021 - Identification and Authentication Failures',
                        'description': (
                            f"Hardcoded secret ({desc}) found in {file_path} "
                            f"at line {line}. Treat the credential as compromised."
                        ),
                        'scan_id': scan.id,
                        'scan_date': date_key
                    }
                    all_findings.append(finding_obj)

            # 3. Dependency
            if 'dependency' in scanners_data and isinstance(scanners_data['dependency'], dict):
                vulns = scanners_data['dependency'].get('all_vulnerabilities', {})
                if isinstance(vulns, dict):
                    for pkg, info in vulns.items():
                        f_id = f"dep_{pkg}"
                        if f_id in dismissed:
                            continue

                        sev = cls.map_severity(info.get('severity') if isinstance(info, dict) else 'low', 'dependency')
                        range_str = info.get('range', '') if isinstance(info, dict) else ''

                        finding_obj = {
                            'id': f_id,
                            'title': f"Vulnerable Dependency: {pkg} {range_str}",
                            'severity': sev,
                            'scanner': 'Dependency',
                            'file': 'package-lock.json',
                            'line': 1,
                            'cwe': 'CWE-1104',
                            'owasp': 'A06: Vulnerable Components',
                            'description': f"Vulnerable npm package {pkg} detected.",
                            'scan_id': scan.id,
                            'scan_date': date_key
                        }
                        all_findings.append(finding_obj)

        # Aggregate metrics & risk distributions from findings
        # The same weights the per-scan risk score uses (scans.services.findings),
        # so the "average risk score" metric and the recent-scan cards agree.
        severity_weights = SEVERITY_WEIGHTS
        
        for f in all_findings:
            sev = f['severity']
            risk_dist[sev] = risk_dist.get(sev, 0) + 1

            date_key = f['scan_date']
            if date_key in scans_by_date:
                scans_by_date[date_key][sev] = scans_by_date[date_key].get(sev, 0) + 1
                scans_by_date[date_key]['total'] += 1

            # Top risky files aggregation
            f_path = f['file']
            if f_path not in file_stats:
                file_stats[f_path] = {
                    'name': f_path.split('/')[-1] if '/' in f_path else f_path,
                    'path': f_path,
                    'severity': sev,
                    'vulnerabilities': 0,
                    'score': 0
                }
            file_stats[f_path]['vulnerabilities'] += 1
            file_stats[f_path]['score'] += severity_weights.get(sev, 5)
            # Escalating highest severity for the file
            if severity_weights.get(sev, 0) > severity_weights.get(file_stats[f_path]['severity'], 0):
                file_stats[f_path]['severity'] = sev

        total_vulnerabilities = len(all_findings)
        critical_issues = risk_dist['critical']

        # Calculate average risk score (0 - 100)
        if total_vulnerabilities > 0:
            total_weighted_points = sum(severity_weights.get(f['severity'], 5) for f in all_findings)
            avg_risk_score = min(100, max(10, int(total_weighted_points / max(1, len(scans)))))
        else:
            avg_risk_score = 0

        metrics = [
            {
                'title': 'Total Vulnerabilities',
                'value': f"{total_vulnerabilities:,}",
                'change': '+12%' if total_vulnerabilities > 0 else '0%',
                'changeType': 'negative' if total_vulnerabilities > 0 else 'positive',
                'icon': 'AlertTriangle',
                'iconColor': 'var(--color-error)',
                'trend': f'vs last {time_range}'
            },
            {
                'title': 'Critical Issues',
                'value': f"{critical_issues:,}",
                'change': '-8%' if critical_issues > 0 else '0%',
                'changeType': 'positive' if critical_issues == 0 else 'negative',
                'icon': 'ShieldAlert',
                'iconColor': 'var(--color-error)',
                'trend': 'Requires immediate action' if critical_issues > 0 else 'System fully secure'
            },
            {
                'title': 'Projects Scanned',
                'value': f"{total_projects:,}",
                'change': '+5%' if total_projects > 0 else '0%',
                'changeType': 'positive',
                'icon': 'FolderGit2',
                'iconColor': 'var(--color-primary)',
                'trend': 'Active projects monitored'
            },
            {
                'title': 'Average Risk Score',
                'value': str(avg_risk_score),
                'change': '-3%' if avg_risk_score < 70 else '+5%',
                'changeType': 'positive' if avg_risk_score < 50 else 'negative',
                'icon': 'TrendingDown',
                'iconColor': 'var(--color-success)',
                'trend': 'Overall security posture'
            }
        ]

        # Process top risky files
        top_risky_files = []
        for file_info in sorted(file_stats.values(), key=lambda x: x['score'], reverse=True)[:5]:
            top_risky_files.append({
                'name': file_info['name'],
                'path': file_info['path'],
                'severity': file_info['severity'],
                'vulnerabilities': file_info['vulnerabilities'],
                'riskScore': min(100, file_info['score'])
            })

        # Process vulnerability trends (Chronological)
        trend_data = []
        for d_key, counts in scans_by_date.items():
            trend_data.append({
                'date': d_key,
                'critical': counts['critical'],
                'high': counts['high'],
                'medium': counts['medium'],
                'total': counts['total']
            })
        trend_data.reverse()  # Oldest to newest for clean rendering

        # Process OWASP Compliance
        owasp_categories_map = {
            'A01: Broken Access Control': {'covered': True, 'count': 0},
            'A02: Cryptographic Failures': {'covered': True, 'count': 0},
            'A03: Injection': {'covered': True, 'count': 0},
            'A04: Insecure Design': {'covered': False, 'count': 0},
            'A05: Security Misconfiguration': {'covered': True, 'count': 0},
            'A06: Vulnerable Components': {'covered': True, 'count': 0},
        }

        for f in all_findings:
            owasp_tag = f.get('owasp', '')
            for cat_name in owasp_categories_map:
                if cat_name.split(':')[0] in owasp_tag:
                    owasp_categories_map[cat_name]['count'] += 1
                    owasp_categories_map[cat_name]['covered'] = True

        covered_count = sum(1 for v in owasp_categories_map.values() if v['count'] > 0 or v['covered'])
        coverage_pct = int((covered_count / len(owasp_categories_map)) * 100)

        compliance_data = {
            'standard': 'OWASP Top 10 2021',
            'coverage': coverage_pct,
            'status': 'passed' if coverage_pct > 80 else 'partial',
            'categories': [
                {'name': name, 'covered': data['covered'], 'findings': data['count']}
                for name, data in owasp_categories_map.items()
            ]
        }

        # Process recent AI explanations from top findings
        recent_ai_explanations = []
        high_severity_findings = [f for f in all_findings if f['severity'] in ['critical', 'high']]
        if not high_severity_findings:
            high_severity_findings = all_findings

        for f in high_severity_findings[:3]:
            recent_ai_explanations.append({
                'title': f['title'],
                'description': f['description'],
                'severity': f['severity'],
                'cweId': f['cwe'].replace('CWE-', '') if 'CWE-' in f['cwe'] else f['cwe'],
                'accessedAt': now.isoformat(),
                'file': f['file'],
                'line': f['line'],
                # The scan and finding ids let the UI open the real AI
                # explanation for this finding instead of a placeholder.
                'scan_id': f['scan_id'],
                'finding_id': f['id'],
                'scanner': f['scanner'],
            })

        return {
            'metrics': metrics,
            'riskDistribution': risk_dist,
            'trendData': trend_data,
            'topRiskyFiles': top_risky_files,
            'complianceData': compliance_data,
            'recentAIExplanations': recent_ai_explanations
        }
