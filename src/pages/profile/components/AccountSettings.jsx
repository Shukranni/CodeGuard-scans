import React from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';

const AccountSettings = ({ 
  profileData, 
  editData, 
  isEditing, 
  onEditChange, 
  onSave, 
  onCancel 
}) => {
  if (!isEditing) {
    return (
      <div className="bg-card rounded-lg border border-border p-8 shadow-glow-md">
        <div className="flex items-center gap-3 mb-6">
          <Icon name="User" size={24} className="text-primary" />
          <h2 className="text-2xl font-heading font-semibold text-foreground">
            Account Information
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {[
            { label: 'Full Name', value: profileData.name, icon: 'User' },
            { label: 'Email Address', value: profileData.email, icon: 'Mail' },
            { label: 'Role', value: profileData.role, icon: 'Briefcase' },
            { label: 'Company', value: profileData.company, icon: 'Building' },
            { label: 'Account Status', value: 'Active', icon: 'CheckCircle' },
            { label: 'Member Since', value: profileData.joined, icon: 'Calendar' },
          ].map((item, index) => (
            <div key={index} className="p-4 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <Icon name={item.icon} size={16} className="text-primary" />
                <p className="text-sm font-medium text-muted-foreground">
                  {item.label}
                </p>
              </div>
              <p className="text-lg font-semibold text-foreground">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border p-8 shadow-glow-md">
      <div className="flex items-center gap-3 mb-6">
        <Icon name="Edit" size={24} className="text-primary" />
        <h2 className="text-2xl font-heading font-semibold text-foreground">
          Edit Account Information
        </h2>
      </div>

      <div className="space-y-6">
        {/* Name */}
        <div>
          <label className="block text-sm font-semibold text-foreground mb-2">
            Full Name
          </label>
          <Input
            value={editData.name}
            onChange={(e) => onEditChange('name', e.target.value)}
            placeholder="Enter your full name"
          />
        </div>

        {/* Email */}
        <div>
          <label className="block text-sm font-semibold text-foreground mb-2">
            Email Address
          </label>
          <Input
            type="email"
            value={editData.email}
            onChange={(e) => onEditChange('email', e.target.value)}
            placeholder="Enter your email"
          />
        </div>

        {/* Role */}
        <div>
          <label className="block text-sm font-semibold text-foreground mb-2">
            Role
          </label>
          <Input
            value={editData.role}
            onChange={(e) => onEditChange('role', e.target.value)}
            placeholder="Enter your role"
          />
        </div>

        {/* Company */}
        <div>
          <label className="block text-sm font-semibold text-foreground mb-2">
            Company
          </label>
          <Input
            value={editData.company}
            onChange={(e) => onEditChange('company', e.target.value)}
            placeholder="Enter your company"
          />
        </div>

        {/* Save/Cancel Buttons */}
        <div className="flex gap-3 pt-4 border-t border-border">
          <Button
            onClick={onSave}
            variant="primary"
            className="flex-1 flex items-center justify-center gap-2"
          >
            <Icon name="Save" size={18} />
            <span>Save Changes</span>
          </Button>
          <Button
            onClick={onCancel}
            variant="outline"
            className="flex-1 flex items-center justify-center gap-2 bg-transparent"
          >
            <Icon name="X" size={18} />
            <span>Cancel</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AccountSettings;
