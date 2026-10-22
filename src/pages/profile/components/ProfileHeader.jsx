import React from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';

const ProfileHeader = ({ profileData, isEditing, editData, onEditChange, onEditToggle }) => {
  return (
    <div className="bg-card rounded-lg border border-border p-8 shadow-glow-md">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 flex-1">
          {/* Avatar */}
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center flex-shrink-0">
            <Icon name="User" size={48} color="white" />
          </div>

          {/* Profile Info */}
          <div className="flex-1">
            {isEditing ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Name
                  </label>
                  <Input
                    value={editData.name}
                    onChange={(e) => onEditChange('name', e.target.value)}
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Email
                  </label>
                  <Input
                    value={editData.email}
                    onChange={(e) => onEditChange('email', e.target.value)}
                    type="email"
                    placeholder="your.email@example.com"
                  />
                </div>
              </div>
            ) : (
              <>
                <h2 className="text-3xl font-heading font-semibold text-foreground mb-1">
                  {profileData.name}
                </h2>
                <p className="text-muted-foreground text-lg mb-2">
                  {profileData.email}
                </p>
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Icon name="Briefcase" size={16} />
                    <span>{profileData.role}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Icon name="Building" size={16} />
                    <span>{profileData.company}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Icon name="Calendar" size={16} />
                    <span>Joined {profileData.joined}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Edit Button */}
        <Button
          onClick={onEditToggle}
          variant={isEditing ? 'secondary' : 'primary'}
          className="flex items-center gap-2"
        >
          <Icon name={isEditing ? 'X' : 'Edit'} size={18} />
          <span>{isEditing ? 'Cancel' : 'Edit Profile'}</span>
        </Button>
      </div>
    </div>
  );
};

export default ProfileHeader;
