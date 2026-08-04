/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";

interface RouteLocation {
  pathname: string;
  search: string;
}

interface NavigateOptions {
  replace?: boolean;
}

type SearchParamsInit = URLSearchParams | Record<string, string>;
type Navigate = (to: string, options?: NavigateOptions) => void;

interface RouterContextValue {
  location: RouteLocation;
  navigate: Navigate;
}

const RouterContext = createContext<RouterContextValue | undefined>(undefined);
const ALLOWED_PATHS = new Set(["/dashboard", "/notes", "/projects", "/archive", "/settings"]);

function normalizeRoute(raw: string): string {
  const candidate = raw.startsWith("/") ? raw : `/${raw}`;
  if (candidate.includes("\\") || candidate.startsWith("//")) {
    return "/dashboard";
  }

  const separator = candidate.indexOf("?");
  const rawPath = separator >= 0 ? candidate.slice(0, separator) : candidate;
  const search = separator >= 0 ? candidate.slice(separator) : "";

  if (rawPath === "/" || rawPath === "/tasks" || rawPath === "/ai") {
    return `/dashboard${search}`;
  }
  if (rawPath === "/types") {
    return "/settings?section=general";
  }
  return ALLOWED_PATHS.has(rawPath) ? `${rawPath}${search}` : "/dashboard";
}

function readLocation(): RouteLocation {
  const normalized = normalizeRoute(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "");
  const separator = normalized.indexOf("?");
  return {
    pathname: separator >= 0 ? normalized.slice(0, separator) : normalized,
    search: separator >= 0 ? normalized.slice(separator) : "",
  };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<RouteLocation>(readLocation);

  const navigate = useCallback<Navigate>((to, options) => {
    const normalized = normalizeRoute(to);
    const nextUrl = `${window.location.pathname}${window.location.search}#${normalized}`;
    if (options?.replace) {
      window.history.replaceState(null, "", nextUrl);
    } else {
      window.history.pushState(null, "", nextUrl);
    }
    setLocation(readLocation());
  }, []);

  useEffect(() => {
    const syncLocation = () => setLocation(readLocation());
    window.addEventListener("hashchange", syncLocation);
    window.addEventListener("popstate", syncLocation);

    const normalized = normalizeRoute(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "");
    if (window.location.hash !== `#${normalized}`) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${normalized}`);
      syncLocation();
    }

    return () => {
      window.removeEventListener("hashchange", syncLocation);
      window.removeEventListener("popstate", syncLocation);
    };
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

function useRouter(): RouterContextValue {
  const value = useContext(RouterContext);
  if (!value) {
    throw new Error("RouterProvider가 필요합니다.");
  }
  return value;
}

export function useLocation(): RouteLocation {
  return useRouter().location;
}

export function useNavigate(): Navigate {
  return useRouter().navigate;
}

export function useSearchParams(): [URLSearchParams, (next: SearchParamsInit, options?: NavigateOptions) => void] {
  const { location, navigate } = useRouter();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const setParams = useCallback(
    (next: SearchParamsInit, options?: NavigateOptions) => {
      const normalized = new URLSearchParams(next);
      const query = normalized.toString();
      navigate(`${location.pathname}${query ? `?${query}` : ""}`, options);
    },
    [location.pathname, navigate],
  );
  return [params, setParams];
}

interface NavLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "href"> {
  to: string;
  className?: string | ((state: { isActive: boolean }) => string);
}

export function NavLink({ to, className, onClick, ...props }: NavLinkProps) {
  const { location, navigate } = useRouter();
  const normalized = normalizeRoute(to);
  const targetPath = normalized.split("?", 1)[0];
  const resolvedClassName = typeof className === "function" ? className({ isActive: location.pathname === targetPath }) : className;

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(normalized);
  };

  return <a {...props} className={resolvedClassName} href={`#${normalized}`} onClick={handleClick} />;
}
