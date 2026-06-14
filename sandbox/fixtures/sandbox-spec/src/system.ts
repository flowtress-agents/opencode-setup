export const OS_FAMILY = "debian";
export const OS_RELEASE = "bookworm";

export const LOCALE = "C.UTF-8";
export const TIMEZONE = "Etc/UTC";
export const LANG = "C.UTF-8";

export const APT_REQUIRED = ["git", "curl", "jq"];

export const GIT_SAFE_DIRECTORY = true;
export const GIT_DEFAULT_BRANCH = "main";
export const GIT_USER_NAME = "agent";
export const GIT_USER_EMAIL = "agent@localhost";

export const PATH_EXTRA = ["/usr/local/bin", "/home/agent/.local/bin"];
