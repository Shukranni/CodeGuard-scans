import React from 'react';
import Icon from '../../../components/AppIcon';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const SummaryDashboard = ({ summaryData }) => {
  const COLORS = {
    high: '#dc2626',
    medium: '#d97706',
    low: '#059669'
  };

  const vulnerabilityDistribution = [
    { name: 'High', value: summaryData?.totalVulnerabilities?.high, color: COLORS?.high },
    { name: 'Medium', value: summaryData?.totalVulnerabilities?.medium, color: COLORS?.medium },
    { name: 'Low', value: summaryData?.totalVulnerabilities?.low, color: COLORS?.low }
  ];

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload?.length) {
      return (
        <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
          <p className="text-sm font-medium text-foreground">{payload?.[0]?.name}</p>
          <p className="text-sm text-muted-foreground">{payload?.[0]?.value} vulnerabilities</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6 mb-6">
      <h2 className="text-xl font-semibold text-foreground mb-6 flex items-center gap-2">
        <Icon name="BarChart3" size={24} />
        Scanning Overview
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-muted rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Total Scans</span>
            <Icon name="Activity" size={20} className="text-primary" />
          </div>
          <p className="text-3xl font-bold text-foreground">{summaryData?.totalScans}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {summaryData?.scansThisMonth} this month
          </p>
        </div>

        <div className="bg-muted rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Projects Analyzed</span>
            <Icon name="FolderOpen" size={20} className="text-accent" />
          </div>
          <p className="text-3xl font-bold text-foreground">{summaryData?.uniqueProjects}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {summaryData?.activeProjects} active
          </p>
        </div>

        <div className="bg-muted rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Avg Scan Time</span>
            <Icon name="Clock" size={20} className="text-warning" />
          </div>
          <p className="text-3xl font-bold text-foreground">{summaryData?.avgScanTime}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {summaryData?.scanTimeImprovement} faster
          </p>
        </div>

        <div className="bg-muted rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Total Issues</span>
            <Icon name="AlertTriangle" size={20} className="text-error" />
          </div>
          <p className="text-3xl font-bold text-foreground">{summaryData?.totalIssuesFound}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {summaryData?.issuesTrend}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-4">Vulnerability Distribution</h3>
          <div className="h-64" aria-label="Vulnerability Distribution Pie Chart">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={vulnerabilityDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100)?.toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {vulnerabilityDistribution?.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry?.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-foreground mb-4">Scanning Frequency (Last 7 Days)</h3>
          <div className="h-64" aria-label="Scanning Frequency Bar Chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summaryData?.scanningFrequency}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="scans" fill="#2563eb" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SummaryDashboard;
