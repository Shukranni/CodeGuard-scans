import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import NotificationContainer from '../components/ui/NotificationContainer';
import { emitNotification } from '../utils/notifications';

const NotificationContext = createContext(null);

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used inside <NotificationProvider>');
  }
  return context;
};

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    const handleNotify = (event) => {
      const notification = event.detail;
      setNotifications((current) => [...current, notification]);
    };

    window.addEventListener('codeguard:notify', handleNotify);
    return () => window.removeEventListener('codeguard:notify', handleNotify);
  }, []);

  const dismissNotification = (id) => {
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  };

  const value = useMemo(() => ({
    notify: emitNotification,
    success: (title, message, options) => emitNotification({ type: 'success', title, message, ...options }),
    error: (title, message, options) => emitNotification({ type: 'error', title, message, ...options }),
    warning: (title, message, options) => emitNotification({ type: 'warning', title, message, ...options }),
    info: (title, message, options) => emitNotification({ type: 'info', title, message, ...options }),
    dismiss: dismissNotification,
  }), []);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <NotificationContainer notifications={notifications} onDismiss={dismissNotification} />
    </NotificationContext.Provider>
  );
};

export default NotificationContext;
