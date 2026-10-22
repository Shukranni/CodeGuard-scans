import React, { useState, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import ProgressIndicator from '../../../components/ui/ProgressIndicator';

const FileUploadZone = ({ onFileSelect, uploadProgress, isUploading }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const fileInputRef = useRef(null);

  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  const ALLOWED_EXTENSIONS = ['.zip'];

  const validateFile = (file) => {
    if (!file) {
      setFileError('Please select a file');
      return false;
    }

    const fileExtension = '.' + file?.name?.split('.')?.pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS?.includes(fileExtension)) {
      setFileError('Only ZIP files are supported');
      return false;
    }

    if (file?.size > MAX_FILE_SIZE) {
      setFileError('File size must be less than 100MB');
      return false;
    }

    setFileError('');
    return true;
  };

  const handleDragEnter = (e) => {
    e?.preventDefault();
    e?.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e?.preventDefault();
    e?.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e?.preventDefault();
    e?.stopPropagation();
  };

  const handleDrop = (e) => {
    e?.preventDefault();
    e?.stopPropagation();
    setIsDragging(false);

    const files = e?.dataTransfer?.files;
    if (files && files?.length > 0) {
      const file = files?.[0];
      if (validateFile(file)) {
        setSelectedFile(file);
        onFileSelect(file);
      }
    }
  };

  const handleFileInputChange = (e) => {
    const file = e?.target?.files?.[0];
    if (file && validateFile(file)) {
      setSelectedFile(file);
      onFileSelect(file);
    }
  };

  const handleBrowseClick = () => {
    fileInputRef?.current?.click();
  };

  const handleClearFile = () => {
    setSelectedFile(null);
    setFileError('');
    if (fileInputRef?.current) {
      fileInputRef.current.value = '';
    }
    onFileSelect(null);
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes?.[i];
  };

  return (
    <div className="w-full">
      <div
        className={`relative border-2 border-dashed rounded-lg transition-all duration-200 ${
          isDragging
            ? 'border-primary bg-primary/5 scale-[1.02]'
            : selectedFile
            ? 'border-success bg-success/5'
            : fileError
            ? 'border-error bg-error/5' :'border-border bg-card hover:border-primary/50 hover:bg-muted/50'
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          onChange={handleFileInputChange}
          className="hidden"
          disabled={isUploading}
        />

        <div className="p-8 sm:p-12 text-center">
          {!selectedFile ? (
            <>
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Icon name="Upload" size={32} color="var(--color-primary)" />
                </div>
              </div>

              <h3 className="text-lg font-semibold text-foreground mb-2">
                Drop your ZIP file here
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                or click to browse from your computer
              </p>

              <Button
                variant="outline"
                onClick={handleBrowseClick}
                iconName="FolderOpen"
                iconPosition="left"
                disabled={isUploading}
              >
                Browse Files
              </Button>

              <div className="mt-6 pt-6 border-t border-border">
                <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Icon name="FileArchive" size={16} />
                    <span>ZIP files only</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Icon name="HardDrive" size={16} />
                    <span>Max 100MB</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
                  <Icon name="CheckCircle" size={32} color="var(--color-success)" />
                </div>
              </div>

              <h3 className="text-lg font-semibold text-foreground mb-2">
                File Selected
              </h3>

              <div className="bg-background rounded-lg p-4 mb-4 max-w-md mx-auto">
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0">
                    <Icon name="FileArchive" size={24} color="var(--color-primary)" />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-medium text-foreground truncate">
                      {selectedFile?.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(selectedFile?.size)}
                    </p>
                  </div>
                  {!isUploading && (
                    <button
                      onClick={handleClearFile}
                      className="flex-shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      aria-label="Remove file"
                    >
                      <Icon name="X" size={20} />
                    </button>
                  )}
                </div>
              </div>

              {isUploading && (
                <div className="max-w-md mx-auto">
                  <ProgressIndicator
                    value={uploadProgress}
                    max={100}
                    label="Uploading file..."
                    variant={uploadProgress === 100 ? 'success' : 'default'}
                  />
                </div>
              )}

              {!isUploading && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBrowseClick}
                  iconName="RefreshCw"
                  iconPosition="left"
                >
                  Choose Different File
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {fileError && (
        <div className="mt-3 flex items-center gap-2 text-sm text-error">
          <Icon name="AlertCircle" size={16} />
          <span>{fileError}</span>
        </div>
      )}
    </div>
  );
};

export default FileUploadZone;
