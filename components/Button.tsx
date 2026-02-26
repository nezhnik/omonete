import { type ButtonHTMLAttributes, type AnchorHTMLAttributes, type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

type CommonProps = {
  variant?: ButtonVariant;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

type ButtonProps =
  & CommonProps
  & (
    | ({ href?: undefined } & ButtonHTMLAttributes<HTMLButtonElement>)
    | ({ href: string } & AnchorHTMLAttributes<HTMLAnchorElement>)
  );

export function Button(props: ButtonProps) {
  const {
    variant = "primary",
    leftIcon,
    rightIcon,
    className = "",
    href,
    children,
    ...rest
  } = props as any;

  const isLink = typeof href === "string" && href.length > 0;
  const isDisabledButton =
    !isLink && (rest as ButtonHTMLAttributes<HTMLButtonElement>).disabled;

  const baseClasses =
    "inline-flex items-center justify-center gap-2 rounded-[300px] px-4 py-3 text-[16px] font-medium transition-colors duration-150";

  const variantClasses: Record<ButtonVariant, string> = {
    primary: isDisabledButton
      ? "bg-[#11111B] text-white"
      : "bg-[#11111B] text-white hover:bg-[#27273a]",
    secondary: isDisabledButton
      ? "bg-[#F1F1F2] text-black"
      : "bg-[#F1F1F2] text-black hover:bg-[#e1e1e3]",
    ghost: isDisabledButton
      ? "bg-transparent text-black"
      : "bg-transparent text-black hover:text-[#666666] active:bg-transparent focus:bg-transparent",
  };

  const stateClasses = isDisabledButton
    ? "opacity-70 cursor-not-allowed"
    : "cursor-pointer";

  const currentVariantClasses = variantClasses[variant as ButtonVariant];

  const classes = `${baseClasses} ${currentVariantClasses} ${stateClasses} ${className}`.trim();

  const content = (
    <>
      {leftIcon && <span className="flex items-center justify-center">{leftIcon}</span>}
      <span>{children}</span>
      {rightIcon && <span className="flex items-center justify-center">{rightIcon}</span>}
    </>
  );

  if (href) {
    return (
      <a href={href} className={classes} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {content}
      </a>
    );
  }

  return (
    <button className={classes} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {content}
    </button>
  );
}

