const NOTIFY_EVENT = 'codeguard:notify';

export const emitNotification = (notification) => {
  if (typeof window === 'undefined') return null;

  const payload = {
    id: notification?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: notification?.type || 'info',
    title: notification?.title || 'Update',
    message: notification?.message || '',
    duration: notification?.duration ?? 5000,
    action: notification?.action || null,
    details: notification?.details || null,
  };

  window.dispatchEvent(new CustomEvent(NOTIFY_EVENT, { detail: payload }));
  return payload.id;
};

const toText = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => toText(item))
      .filter(Boolean)
      .join(' ');
  }

  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const nested = Object.values(value)
      .map((item) => toText(item))
      .filter(Boolean)
      .join(' ');
    return nested;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
};

export const getApiErrorMessage = (error, fallbackMessage = 'Something went wrong. Please try again.') => {
  const status = error?.response?.status;
  const data = error?.response?.data;
  const detail = data?.detail || data?.message || data?.error || data?.non_field_errors;

  const firstString = (source) => {
    if (!source) return '';
    if (typeof source === 'string') return source.trim();
    if (Array.isArray(source)) return source.map((item) => firstString(item)).filter(Boolean)[0] || '';
    if (typeof source === 'object') {
      const flat = Object.values(source).map((item) => firstString(item)).filter(Boolean);
      return flat[0] || '';
    }
    return '';
  };

  const baseMessage = firstString(detail) || toText(data) || error?.message || '';

  if (status === 400) {
    return {
      title: 'Request could not be completed',
      message: baseMessage || 'Please review the form and try again.',
    };
  }

  if (status === 401) {
    return {
      title: 'Session expired',
      message: baseMessage || 'Your session seems to have expired. Please sign in again.',
    };
  }

  if (status === 403) {
    return {
      title: 'Access denied',
      message: baseMessage || 'You do not have permission to perform this action.',
    };
  }

  if (status === 404) {
    return {
      title: 'Resource not found',
      message: baseMessage || 'The requested item could not be found.',
    };
  }

  if (status === 409) {
    return {
      title: 'Conflict',
      message: baseMessage || 'This request conflicts with the current state. Please try again.',
    };
  }

  if (status === 413) {
    return {
      title: 'File too large',
      message: baseMessage || 'The uploaded file is larger than the supported limit.',
    };
  }

  if (status === 429) {
    return {
      title: 'Too many attempts',
      message: baseMessage || 'You are making requests too quickly. Please wait a moment and try again.',
    };
  }

  if (error?.code === 'ECONNABORTED' || error?.message === 'timeout of ... exceeded') {
    return {
      title: 'Request timed out',
      message: 'The server took too long to respond. Please try again.',
    };
  }

  if (!error?.response) {
    return {
      title: 'Connection problem',
      message: 'Could not reach the server. Please check your connection and try again.',
    };
  }

  if (status >= 500) {
    return {
      title: 'Server error',
      message: baseMessage || 'Something went wrong on the server. Please try again in a moment.',
    };
  }

  return {
    title: 'Unable to complete action',
    message: baseMessage || fallbackMessage,
  };
};

export const notifyApiError = (error, fallbackMessage) => {
  const { title, message } = getApiErrorMessage(error, fallbackMessage);
  emitNotification({
    type: 'error',
    title,
    message,
    duration: 7000,
  });
};

export const notifySuccess = (title, message, options = {}) =>
  emitNotification({ type: 'success', title, message, duration: 4200, ...options });

export const notifyWarning = (title, message, options = {}) =>
  emitNotification({ type: 'warning', title, message, duration: 5600, ...options });

export const notifyInfo = (title, message, options = {}) =>
  emitNotification({ type: 'info', title, message, duration: 4800, ...options });
