import React from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Icon from '../components/AppIcon';

const NotFound = () => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 text-center">
      <div className="max-w-md">
        <div className="relative mb-6 flex justify-center">
          <span className="text-8xl font-bold tracking-tight text-primary/10 sm:text-9xl">404</span>
        </div>
        <div className="mb-6 flex justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon name="FileQuestion" size={30} aria-hidden="true" />
          </span>
        </div>
        <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button variant="outline" iconName="ArrowLeft" iconPosition="left" onClick={() => window.history?.back()}>
            Go back
          </Button>
          <Button iconName="Home" iconPosition="left" onClick={() => navigate('/dashboard')}>
            Go to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
