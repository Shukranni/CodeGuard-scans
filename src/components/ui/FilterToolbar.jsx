import React, { useState, useEffect } from 'react';
import Input from './Input';
import Select from './Select';
import Button from './Button';


const FilterToolbar = ({ 
  onSearchChange,
  onFilterChange,
  onExport,
  searchPlaceholder = 'Search vulnerabilities...',
  showExport = true,
  filterOptions = []
}) => {
  const [searchValue, setSearchValue] = useState('');
  const [selectedFilters, setSelectedFilters] = useState({});
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      if (onSearchChange) {
        onSearchChange(searchValue);
      }
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [searchValue, onSearchChange]);

  const handleSearchChange = (e) => {
    setSearchValue(e?.target?.value);
  };

  const handleFilterChange = (filterKey, value) => {
    const newFilters = {
      ...selectedFilters,
      [filterKey]: value
    };
    setSelectedFilters(newFilters);
    
    if (onFilterChange) {
      onFilterChange(newFilters);
    }
  };

  const handleClearFilters = () => {
    setSearchValue('');
    setSelectedFilters({});
    
    if (onSearchChange) {
      onSearchChange('');
    }
    if (onFilterChange) {
      onFilterChange({});
    }
  };

  const hasActiveFilters = searchValue || Object.keys(selectedFilters)?.length > 0;

  const severityOptions = [
    { value: 'all', label: 'All Severities' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' }
  ];

  const categoryOptions = [
    { value: 'all', label: 'All Categories' },
    { value: 'injection', label: 'Injection' },
    { value: 'authentication', label: 'Authentication' },
    { value: 'xss', label: 'Cross-Site Scripting' },
    { value: 'cryptography', label: 'Cryptography' },
    { value: 'configuration', label: 'Configuration' }
  ];

  return (
    <div className="filter-toolbar">
      <div className="filter-toolbar-search">
        <Input
          type="search"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={handleSearchChange}
          className="w-full"
        />
      </div>
      <div className="hidden lg:flex items-center gap-2">
        <Select
          options={severityOptions}
          value={selectedFilters?.severity || 'all'}
          onChange={(value) => handleFilterChange('severity', value)}
          placeholder="Severity"
        />
        
        <Select
          options={categoryOptions}
          value={selectedFilters?.category || 'all'}
          onChange={(value) => handleFilterChange('category', value)}
          placeholder="Category"
        />

        {filterOptions?.map((filter) => (
          <Select
            key={filter?.key}
            options={filter?.options}
            value={selectedFilters?.[filter?.key] || filter?.defaultValue || 'all'}
            onChange={(value) => handleFilterChange(filter?.key, value)}
            placeholder={filter?.placeholder}
          />
        ))}
      </div>
      <div className="filter-toolbar-actions">
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearFilters}
            iconName="X"
            iconPosition="left"
          >
            Clear
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          iconName={isExpanded ? 'ChevronUp' : 'ChevronDown'}
          iconPosition="right"
          className="lg:hidden"
        >
          Filters
        </Button>

        {showExport && onExport && (
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            iconName="Download"
            iconPosition="left"
          >
            Export
          </Button>
        )}
      </div>
      {isExpanded && (
        <div className="w-full flex flex-col gap-3 pt-4 border-t border-border lg:hidden">
          <Select
            label="Severity"
            options={severityOptions}
            value={selectedFilters?.severity || 'all'}
            onChange={(value) => handleFilterChange('severity', value)}
          />
          
          <Select
            label="Category"
            options={categoryOptions}
            value={selectedFilters?.category || 'all'}
            onChange={(value) => handleFilterChange('category', value)}
          />

          {filterOptions?.map((filter) => (
            <Select
              key={filter?.key}
              label={filter?.label}
              options={filter?.options}
              value={selectedFilters?.[filter?.key] || filter?.defaultValue || 'all'}
              onChange={(value) => handleFilterChange(filter?.key, value)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default FilterToolbar;
