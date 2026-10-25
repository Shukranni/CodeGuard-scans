import React from 'react';
import NotificationItem from './NotificationItem';

const NotificationContainer = ({ notifications, onDismiss }) => {
  if (!notifications.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[1200] flex w-[min(92vw,24rem)] flex-col gap-3">
      {notifications.map((notification) => (
        <div key={notification.id} className="pointer-events-auto">
          <NotificationItem notification={notification} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
};

export default NotificationContainer;
