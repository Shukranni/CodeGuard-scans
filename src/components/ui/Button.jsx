import React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '../../utils/cn';
import Icon from '../AppIcon';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ' +
    'transition-[background-color,border-color,color,box-shadow] duration-150 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-background ' +
    'disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        primary: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/85',
        outline: 'border border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted',
        subtle: 'bg-muted text-foreground hover:bg-muted/70',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        danger: 'bg-error text-error-foreground shadow-sm hover:bg-error/90',
        success: 'bg-success text-success-foreground shadow-sm hover:bg-success/90',
        warning: 'bg-warning text-warning-foreground shadow-sm hover:bg-warning/90',
      },
      size: {
        xs: 'h-8 px-2.5 text-xs',
        sm: 'h-9 px-3',
        default: 'h-10 px-4',
        lg: 'h-11 px-6',
        xl: 'h-12 px-8 text-base',
        icon: 'h-10 w-10 p-0',
        'icon-sm': 'h-9 w-9 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

const ICON_SIZE_MAP = {
  xs: 13,
  sm: 14,
  default: 16,
  lg: 17,
  xl: 18,
  icon: 17,
  'icon-sm': 16,
};

const LoadingSpinner = ({ className }) => (
  <svg
    className={cn('h-4 w-4 shrink-0 animate-spin', className)}
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

const Button = React.forwardRef(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      children,
      loading = false,
      iconName = null,
      iconPosition = 'left',
      iconSize = null,
      fullWidth = false,
      disabled = false,
      type = 'button',
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    const calculatedIconSize = iconSize || ICON_SIZE_MAP?.[size] || 16;
    const isDisabled = disabled || loading;

    const icon = iconName ? (
      <Icon
        name={iconName}
        size={calculatedIconSize}
        className="shrink-0"
        aria-hidden="true"
      />
    ) : null;

    const content = (
      <>
        {loading ? <LoadingSpinner /> : null}
        {!loading && icon && iconPosition === 'left' ? icon : null}
        {children}
        {!loading && icon && iconPosition === 'right' ? icon : null}
      </>
    );

    const classes = cn(buttonVariants({ variant, size, className }), fullWidth && 'w-full');

    // ── `asChild` renders the child element with the button's styling ──────
    if (asChild) {
      const child = React.Children.count(children) === 1 ? React.Children.only(children) : null;

      if (!child || !React.isValidElement(child)) {
        return (
          <button
            type={type}
            className={classes}
            ref={ref}
            disabled={isDisabled}
            aria-busy={loading || undefined}
            {...props}
          >
            {content}
          </button>
        );
      }

      const childIsNativeControl =
        child.type === 'button' || child.type === 'input' || child.type === 'select';

      return (
        <Slot
          ref={ref}
          aria-disabled={!childIsNativeControl && isDisabled ? true : undefined}
          aria-busy={loading || undefined}
          {...props}
        >
          {React.cloneElement(child, {
            className: cn(classes, child?.props?.className),
            ...(childIsNativeControl ? { disabled: isDisabled } : {}),
            children: content,
          })}
        </Slot>
      );
    }

    return (
      <button
        type={type}
        className={classes}
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        {...props}
      >
        {content}
      </button>
    );
  },
);

Button.displayName = 'Button';
export default Button;
