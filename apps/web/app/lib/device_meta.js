const HEX_COLOR_PATTERN = /^#?([A-Fa-f0-9]{6})$/;
const DEFAULT_REQUIREMENT_SERVER_TYPE = "vps";
const DEFAULT_REQUIREMENT_STORAGE_GB = "200";
const DEFAULT_REQUIREMENT_LOCATION = "Germany";
const DEFAULT_PRIMARY_DOMAIN = "localhost";

function normalizeDeviceColor(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(HEX_COLOR_PATTERN);
  if (!match) return null;
  return `#${match[1].toUpperCase()}`;
}

function normalizeDeviceEmoji(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw;
}

function normalizeRequirementServerType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  return raw;
}

function normalizeRequirementStorageGb(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return String(Math.max(0, Math.floor(value)));
  }
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return String(Math.max(0, Math.floor(parsed)));
}

function normalizeRequirementLocation(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw;
}

export function createServerPlaceholder(alias) {
  return {
    alias: String(alias || "").trim(),
    description: "",
    primaryDomain: DEFAULT_PRIMARY_DOMAIN,
    requirementServerType: DEFAULT_REQUIREMENT_SERVER_TYPE,
    requirementStorageGb: DEFAULT_REQUIREMENT_STORAGE_GB,
    requirementLocation: DEFAULT_REQUIREMENT_LOCATION,
    host: "",
    port: "22",
    user: "root",
    color: "",
    logoEmoji: "",
    authMethod: "password",
    password: "",
    privateKey: "",
    publicKey: "",
    keyAlgorithm: "ed25519",
    keyPassphrase: "",
  };
}

export function normalizePersistedDeviceMeta(servers) {
  return (Array.isArray(servers) ? servers : []).map((server) => {
    const normalizedColor = normalizeDeviceColor(server?.color);
    const normalizedLogo = normalizeDeviceEmoji(server?.logoEmoji);
    const normalizedRequirementServerType =
      normalizeRequirementServerType(server?.requirementServerType) ||
      DEFAULT_REQUIREMENT_SERVER_TYPE;
    const normalizedRequirementStorageGb =
      normalizeRequirementStorageGb(server?.requirementStorageGb) ||
      DEFAULT_REQUIREMENT_STORAGE_GB;
    const normalizedRequirementLocation =
      normalizeRequirementLocation(server?.requirementLocation) ||
      DEFAULT_REQUIREMENT_LOCATION;
    const normalizedPrimaryDomain = String(server?.primaryDomain ?? "")
      .trim()
      .toLowerCase();
    const hasPrimaryDomain = Boolean(
      server &&
        typeof server === "object" &&
        Object.prototype.hasOwnProperty.call(server, "primaryDomain")
    );
    return {
      ...server,
      description: String(server?.description || ""),
      primaryDomain:
        normalizedPrimaryDomain ||
        (hasPrimaryDomain ? "" : DEFAULT_PRIMARY_DOMAIN),
      requirementServerType: normalizedRequirementServerType,
      requirementStorageGb: normalizedRequirementStorageGb,
      requirementLocation: normalizedRequirementLocation,
      color: normalizedColor || "",
      logoEmoji: normalizedLogo || "",
    };
  });
}

function parseHostVarsValues(data) {
  const node =
    data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const requirementsNode =
    node.server_requirements &&
    typeof node.server_requirements === "object" &&
    !Array.isArray(node.server_requirements)
      ? node.server_requirements
      : {};
  const hasRequirementServerType =
    Object.prototype.hasOwnProperty.call(requirementsNode, "server_type") ||
    Object.prototype.hasOwnProperty.call(node, "server_type");
  const hasRequirementStorageGb =
    Object.prototype.hasOwnProperty.call(requirementsNode, "storage_gb") ||
    Object.prototype.hasOwnProperty.call(node, "storage_gb");
  const hasRequirementLocation =
    Object.prototype.hasOwnProperty.call(requirementsNode, "location") ||
    Object.prototype.hasOwnProperty.call(node, "location");
  const rawRequirementServerType = Object.prototype.hasOwnProperty.call(
    requirementsNode,
    "server_type"
  )
    ? requirementsNode.server_type
    : node.server_type;
  const rawRequirementStorageGb = Object.prototype.hasOwnProperty.call(
    requirementsNode,
    "storage_gb"
  )
    ? requirementsNode.storage_gb
    : node.storage_gb;
  const rawRequirementLocation = Object.prototype.hasOwnProperty.call(
    requirementsNode,
    "location"
  )
    ? requirementsNode.location
    : node.location;
  const nextHost =
    typeof node.ansible_host === "string" ? String(node.ansible_host || "").trim() : "";
  const nextUser =
    typeof node.ansible_user === "string" ? String(node.ansible_user || "").trim() : "";
  const nextDescription =
    typeof node.description === "string" ? String(node.description || "") : "";
  const nextPrimaryDomain =
    typeof node.DOMAIN_PRIMARY === "string" ? String(node.DOMAIN_PRIMARY || "") : "";
  const rawColor =
    typeof node.color === "string"
      ? node.color
      : node.infinito &&
        typeof node.infinito === "object" &&
        !Array.isArray(node.infinito) &&
        node.infinito.device &&
        typeof node.infinito.device === "object" &&
        !Array.isArray(node.infinito.device) &&
        typeof node.infinito.device.color === "string"
      ? node.infinito.device.color
      : "";
  const nextColor = normalizeDeviceColor(rawColor) || "";
  const rawLogoEmoji =
    node.logo &&
    typeof node.logo === "object" &&
    !Array.isArray(node.logo) &&
    typeof node.logo.emoji === "string"
      ? String(node.logo.emoji || "")
      : typeof node.logoEmoji === "string"
      ? node.logoEmoji
      : typeof node.logo_emoji === "string"
      ? node.logo_emoji
      : node.infinito &&
        typeof node.infinito === "object" &&
        !Array.isArray(node.infinito) &&
        node.infinito.device &&
        typeof node.infinito.device === "object" &&
        !Array.isArray(node.infinito.device) &&
        typeof node.infinito.device.logo_emoji === "string"
      ? node.infinito.device.logo_emoji
      : node.infinito &&
        typeof node.infinito === "object" &&
        !Array.isArray(node.infinito) &&
        node.infinito.device &&
        typeof node.infinito.device === "object" &&
        !Array.isArray(node.infinito.device) &&
        typeof node.infinito.device.logoEmoji === "string"
      ? node.infinito.device.logoEmoji
      : "";
  const nextLogoEmoji = normalizeDeviceEmoji(rawLogoEmoji) || "";
  const nextRequirementServerType = hasRequirementServerType
    ? normalizeRequirementServerType(rawRequirementServerType) || ""
    : "";
  const nextRequirementStorageGb = hasRequirementStorageGb
    ? normalizeRequirementStorageGb(rawRequirementStorageGb) || ""
    : "";
  const nextRequirementLocation = hasRequirementLocation
    ? normalizeRequirementLocation(rawRequirementLocation) || ""
    : "";
  let nextPort = "";
  if (typeof node.ansible_port === "number") {
    nextPort = Number.isFinite(node.ansible_port) ? String(node.ansible_port) : "";
  } else if (typeof node.ansible_port === "string") {
    const parsedPort = Number(String(node.ansible_port || "").trim());
    if (Number.isInteger(parsedPort)) {
      nextPort = String(parsedPort);
    }
  }

  return {
    nextHost,
    nextUser,
    nextDescription,
    nextPrimaryDomain,
    nextColor,
    nextLogoEmoji,
    nextRequirementServerType,
    nextRequirementStorageGb,
    nextRequirementLocation,
    hasRequirementServerType,
    hasRequirementStorageGb,
    hasRequirementLocation,
    nextPort,
  };
}

export function parseHostVarsServerPatchData(data) {
  const {
    nextHost,
    nextUser,
    nextDescription,
    nextPrimaryDomain,
    nextColor,
    nextLogoEmoji,
    nextRequirementServerType,
    nextRequirementStorageGb,
    nextRequirementLocation,
    hasRequirementServerType,
    hasRequirementStorageGb,
    hasRequirementLocation,
    nextPort,
  } = parseHostVarsValues(data);
  const patch = {};
  if (nextHost) patch.host = nextHost;
  if (nextUser) patch.user = nextUser;
  if (nextPort) patch.port = nextPort;
  patch.description = nextDescription;
  patch.primaryDomain = nextPrimaryDomain;
  if (hasRequirementServerType) {
    patch.requirementServerType = nextRequirementServerType;
  }
  if (hasRequirementStorageGb) {
    patch.requirementStorageGb = nextRequirementStorageGb;
  }
  if (hasRequirementLocation) {
    patch.requirementLocation = nextRequirementLocation;
  }
  if (nextColor) patch.color = nextColor;
  if (nextLogoEmoji) patch.logoEmoji = nextLogoEmoji;
  return patch;
}

export function buildCredentialsPatchFromHostVarsData(data, credentials) {
  const {
    nextHost,
    nextUser,
    nextDescription,
    nextPrimaryDomain,
    nextColor,
    nextLogoEmoji,
    nextRequirementServerType,
    nextRequirementStorageGb,
    nextRequirementLocation,
    hasRequirementServerType,
    hasRequirementStorageGb,
    hasRequirementLocation,
    nextPort,
  } = parseHostVarsValues(data);
  const patch = {};
  if (nextHost && !credentials.host) {
    patch.host = nextHost;
  }
  if (nextUser && (!credentials.user || credentials.user === "root") && nextUser !== "root") {
    patch.user = nextUser;
  }
  if (nextPort && (!credentials.port || credentials.port === "22") && nextPort !== "22") {
    patch.port = nextPort;
  }
  if (nextDescription !== credentials.description) {
    patch.description = nextDescription;
  }
  if (nextPrimaryDomain !== credentials.primaryDomain) {
    patch.primaryDomain = nextPrimaryDomain;
  }
  if (
    hasRequirementServerType &&
    nextRequirementServerType !== credentials.requirementServerType
  ) {
    patch.requirementServerType = nextRequirementServerType;
  }
  if (
    hasRequirementStorageGb &&
    nextRequirementStorageGb !== credentials.requirementStorageGb
  ) {
    patch.requirementStorageGb = nextRequirementStorageGb;
  }
  if (
    hasRequirementLocation &&
    nextRequirementLocation !== credentials.requirementLocation
  ) {
    patch.requirementLocation = nextRequirementLocation;
  }
  if (nextColor && nextColor !== credentials.color) {
    patch.color = nextColor;
  }
  if (nextLogoEmoji && nextLogoEmoji !== credentials.logoEmoji) {
    patch.logoEmoji = nextLogoEmoji;
  }
  return patch;
}
