export interface ResponseHeader {
  name: string;
  value?: string;
  binaryValue?: number[];
}

export interface ResponsePolicy {
  allowed: boolean;
  reason?: string;
}

// Headers are not signed. These can add resources, suppress signed styles,
// redirect the document, or change its interpretation. Unsupported policy
// never invalidates a correct body signature, but it cannot qualify for green.
const displayHeaders = new Map([
  ["link", "An unsigned Link response header can load additional resources."],
  ["refresh", "An unsigned Refresh response header can navigate away automatically."],
  ["content-security-policy", "An unsigned Content-Security-Policy response header can change the display of signed content."],
  ["content-security-policy-report-only", "An unsigned reporting policy can cause additional network requests."],
  ["content-language", "An unsigned Content-Language response header can change language-dependent display."],
  ["content-disposition", "An unsigned Content-Disposition response header can change document presentation."],
  ["content-location", "An unsigned Content-Location response header is outside the supported display policy."],
  ["content-style-type", "An unsigned Content-Style-Type response header can change stylesheet interpretation."],
]);

export function checkResponseHeaders(status: number, headers?: ResponseHeader[]): ResponsePolicy {
  if (status !== 200) return {allowed: false, reason: "Only complete HTTP 200 page responses qualify for display verification."};
  if (!headers) return {allowed: false, reason: "The delivered response headers could not be checked."};
  const contentTypes: ResponseHeader[] = [];
  for (const header of headers) {
    const name = header.name.toLowerCase();
    const reason = displayHeaders.get(name);
    if (reason) return {allowed: false, reason};
    if (name === "content-type") contentTypes.push(header);
  }
  const header = contentTypes.length === 1 ? contentTypes[0] : undefined;
  const type = header?.binaryValue === undefined ? header?.value : undefined;
  if (!type || /[\x00-\x1f\x7f]/.test(type) || !/^(?:text\/html|application\/xhtml\+xml)\s*;\s*charset\s*=\s*(?:utf-8|"utf-8")\s*$/i.test(type.trim())) {
    return {allowed: false, reason: "The delivered response must declare text/html or application/xhtml+xml with charset=UTF-8."};
  }
  return {allowed: true};
}

export function checkResponseDisplay(policy: ResponsePolicy | undefined, bytes: Uint8Array): ResponsePolicy {
  if (!policy) return {allowed: false, reason: "The delivered response headers could not be checked."};
  if (!policy.allowed) return policy;
  try {
    const text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    if (text.includes("\0")) throw new Error("NUL is not valid XHTML text");
  } catch {
    return {allowed: false, reason: "The signed response body is not supported UTF-8 text."};
  }
  return policy;
}
