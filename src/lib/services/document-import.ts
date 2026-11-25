import { createHash } from "node:crypto";

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream } from "pdf-lib";

import type { EnvelopePageRecord } from "../schemas/envelope.ts";
import { MAX_PDF_PAGES, MAX_UPLOAD_SIZE_BYTES } from "../types/domain.ts";
import { getDisplayedPageGeometry } from "./pdf-page-geometry.ts";

const PDF_MAGIC_HEADER = "%PDF-";

const PDF_IMPORT_ERROR_MESSAGES = {
  encrypted_pdf:
    "This PDF is password-protected or encrypted. Please upload an unlocked PDF.",
  invalid_type: "Only PDF files are supported. Please upload a valid PDF.",
  too_large: "This file exceeds the 20 MB limit.",
  too_many_pages: `This PDF has more than ${String(MAX_PDF_PAGES)} pages. Split it into smaller documents.`,
  unreadable_pdf: "We couldn't read this PDF. Please upload a valid file.",
  unsupported_variant:
    "This PDF uses an unsupported format. Please export it as a standard PDF.",
  upload_failed: "Upload failed. Please try again.",
} as const;

export const pdfImportFailureCodes = [
  "encrypted_pdf",
  "invalid_type",
  "too_large",
  "too_many_pages",
  "unreadable_pdf",
  "unsupported_variant",
  "upload_failed",
] as const;

export type PdfImportFailureCode = (typeof pdfImportFailureCodes)[number];

export type PdfImportError = {
  code: PdfImportFailureCode;
  message: string;
};

export type ImportedPdfPage = Pick<
  EnvelopePageRecord,
  "heightPt" | "pageNumber" | "widthPt"
>;

export type ImportedPdfDocument = {
  encrypted: boolean;
  filename: string;
  pageCount: number;
  pages: ImportedPdfPage[];
  pureXfa: boolean;
  sizeBytes: number;
  sourceHash: string;
};

type ImportPdfDocumentInput = {
  body: Uint8Array;
  contentType?: string | null;
  filename: string;
  maxSizeBytes?: number;
};

export class DocumentImportError extends Error {
  code: PdfImportFailureCode;

  constructor(
    code: PdfImportFailureCode,
    message = getPdfImportErrorMessage(code),
  ) {
    super(message);
    this.code = code;
    this.name = "DocumentImportError";
  }
}

export const DEFAULT_DOCUMENT_IMPORT_LIMITS = {
  maxSizeBytes: MAX_UPLOAD_SIZE_BYTES,
};

export function getPdfImportErrorMessage(code: PdfImportFailureCode): string {
  return PDF_IMPORT_ERROR_MESSAGES[code];
}

function assertImportRequest(input: {
  contentType?: string | null;
  filename: string;
  maxSizeBytes: number;
  sizeBytes: number;
}): void {
  if (!input.filename.toLowerCase().endsWith(".pdf")) {
    throw new DocumentImportError("invalid_type");
  }

  const normalizedContentType = input.contentType?.trim().toLowerCase() ?? "";

  if (
    normalizedContentType.length > 0 &&
    normalizedContentType !== "application/pdf"
  ) {
    throw new DocumentImportError("invalid_type");
  }

  if (input.sizeBytes > input.maxSizeBytes) {
    throw new DocumentImportError("too_large");
  }
}

function isPasswordException(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const normalizedMessage = error.message.trim().toLowerCase();

  return (
    error.name === "PasswordException" ||
    normalizedMessage.includes("password") ||
    normalizedMessage.includes("encrypted")
  );
}

function looksLikePdf(body: Uint8Array): boolean {
  if (body.length < PDF_MAGIC_HEADER.length) {
    return false;
  }

  const header = new TextDecoder("latin1").decode(
    body.subarray(0, PDF_MAGIC_HEADER.length),
  );

  return header === PDF_MAGIC_HEADER;
}

function maybeContainsXfa(body: Uint8Array): boolean {
  const prefix = new TextDecoder("latin1").decode(
    body.subarray(0, Math.min(body.length, 512 * 1024)),
  );

  return prefix.includes("/XFA");
}

function maybeContainsEncrypt(body: Uint8Array): boolean {
  const prefix = new TextDecoder("latin1").decode(
    body.subarray(0, Math.min(body.length, 512 * 1024)),
  );

  return prefix.includes("/Encrypt");
}

const BLOCKED_PDF_KEYS = new Set([
  "AA",
  "EF",
  "EmbeddedFiles",
  "JavaScript",
  "JS",
  "RichMediaContent",
  "XFA",
]);
const BLOCKED_PDF_ACTIONS = new Set([
  "JavaScript",
  "Launch",
  "SubmitForm",
  "ImportData",
  "GoToE",
]);
const BLOCKED_PDF_SUBTYPES = new Set([
  "FileAttachment",
  "RichMedia",
  "Screen",
  "Movie",
  "Sound",
  "3D",
]);

/** Inspect parsed PDF objects, including dictionaries in compressed object streams. */
function assertNoActivePdfContent(document: PDFDocument): void {
  const remaining = document.context
    .enumerateIndirectObjects()
    .map(([, object]) => object);
  const seen = new Set();

  while (remaining.length) {
    const object = remaining.pop();
    if (!object || seen.has(object)) continue;
    seen.add(object);

    if (object instanceof PDFStream) {
      remaining.push(object.dict);
    } else if (object instanceof PDFArray) {
      remaining.push(...object.asArray());
    } else if (object instanceof PDFDict) {
      for (const [name, value] of object.entries()) {
        const key = name.decodeText();
        const resolved = document.context.lookup(value);
        const decoded =
          resolved instanceof PDFName ? resolved.decodeText() : null;
        if (
          BLOCKED_PDF_KEYS.has(key) ||
          (key === "S" && decoded && BLOCKED_PDF_ACTIONS.has(decoded)) ||
          (key === "Subtype" && decoded && BLOCKED_PDF_SUBTYPES.has(decoded))
        ) {
          throw new DocumentImportError("unsupported_variant");
        }
        remaining.push(value);
      }
    }
  }
}

async function parsePdfDocument(
  body: Uint8Array,
): Promise<{ pages: ImportedPdfPage[]; pureXfa: boolean }> {
  const document = await PDFDocument.load(body, {
    ignoreEncryption: false,
  });

  if (document.getPageCount() > MAX_PDF_PAGES) {
    throw new DocumentImportError("too_many_pages");
  }

  assertNoActivePdfContent(document);

  // The size of each page as a reader shows it: the CropBox, with width and
  // height swapped on a page rotated a quarter turn. The field overlay is
  // laid out to this size, so it has to match what the browser draws.
  const pages = document.getPages().map((page, index) => {
    const { heightPt, widthPt } = getDisplayedPageGeometry(page);

    return { heightPt, pageNumber: index + 1, widthPt };
  });

  return {
    pages,
    pureXfa: false,
  };
}

function hashDocument(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

export async function importPdfDocument({
  body,
  contentType,
  filename,
  maxSizeBytes = DEFAULT_DOCUMENT_IMPORT_LIMITS.maxSizeBytes,
}: ImportPdfDocumentInput): Promise<ImportedPdfDocument> {
  const normalizedFilename = filename.trim() || "document.pdf";
  const sizeBytes = body.length;

  assertImportRequest({
    contentType,
    filename: normalizedFilename,
    maxSizeBytes,
    sizeBytes,
  });

  if (!looksLikePdf(body)) {
    throw new DocumentImportError("invalid_type");
  }

  const containsEncrypt = maybeContainsEncrypt(body);
  const containsXfa = maybeContainsXfa(body);
  const sourceHash = hashDocument(body);

  if (containsEncrypt) {
    throw new DocumentImportError("encrypted_pdf");
  }

  try {
    const { pages, pureXfa } = await parsePdfDocument(body.slice());

    if (pureXfa || containsXfa) {
      throw new DocumentImportError("unsupported_variant");
    }

    return {
      encrypted: false,
      filename: normalizedFilename,
      pageCount: pages.length,
      pages,
      pureXfa,
      sizeBytes,
      sourceHash,
    };
  } catch (error) {
    if (error instanceof DocumentImportError) {
      throw error;
    }

    if (isPasswordException(error) || containsXfa) {
      if (isPasswordException(error)) {
        throw new DocumentImportError("encrypted_pdf");
      }

      throw new DocumentImportError("unsupported_variant");
    }

    throw new DocumentImportError("unreadable_pdf");
  }
}
