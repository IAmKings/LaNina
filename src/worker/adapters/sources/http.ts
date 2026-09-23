import { SourceCollectionError } from "../../../domain/ingestion";

export async function readBodyWithinLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maxBytes) {
    throw new SourceCollectionError("VALIDATION", "来源响应超过允许大小");
  }

  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new SourceCollectionError("VALIDATION", "来源响应超过允许大小");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function sha256Hex(body: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(body).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function errorForResponse(response: Response): SourceCollectionError {
  const options = { httpStatus: response.status };
  if (response.status === 408) {
    return new SourceCollectionError("NETWORK", "来源请求超时", {
      ...options,
      retryable: true,
    });
  }
  if (response.status === 429) {
    return new SourceCollectionError("RATE_LIMIT", "来源请求受到速率限制", {
      ...options,
      retryable: true,
    });
  }
  if (response.status === 401 || response.status === 403) {
    return new SourceCollectionError("AUTH", "来源拒绝访问", options);
  }
  if (response.status === 404) {
    return new SourceCollectionError("NOT_FOUND", "来源地址不存在", options);
  }
  if (response.status >= 500) {
    return new SourceCollectionError("NETWORK", "来源服务暂时不可用", {
      ...options,
      retryable: true,
    });
  }
  return new SourceCollectionError("VALIDATION", "来源返回不可接受的 HTTP 状态", options);
}
