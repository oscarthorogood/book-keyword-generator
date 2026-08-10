/**
 * Input validation utilities for campaign creation and keyword management.
 */

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** Validates ASIN format (10 alphanumeric characters, typically uppercase) */
export function validateAsin(asin: string): ValidationError | null {
  if (!asin || asin.length !== 10) {
    return { field: "asin", message: "ASIN must be exactly 10 characters" };
  }
  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    return { field: "asin", message: "ASIN must be alphanumeric" };
  }
  return null;
}

/** Validates daily budget is positive and reasonable */
export function validateDailyBudget(budget: number): ValidationError | null {
  if (budget <= 0) {
    return { field: "dailyBudget", message: "Daily budget must be positive" };
  }
  if (budget > 100000) {
    return { field: "dailyBudget", message: "Daily budget seems unreasonably high (max $100,000)" };
  }
  return null;
}

/** Validates bid amount is within reasonable range */
export function validateBid(bid: number, fieldName: string = "bid"): ValidationError | null {
  if (bid < 0.02) {
    return { field: fieldName, message: "Bid must be at least $0.02" };
  }
  if (bid > 2.0) {
    return { field: fieldName, message: "Bid seems unreasonably high (max $2.00)" };
  }
  return null;
}

/** Validates RRP (list price) is positive and reasonable */
export function validateRrp(rrp: number): ValidationError | null {
  if (rrp <= 0) {
    return { field: "rrp", message: "RRP must be positive" };
  }
  if (rrp > 999) {
    return { field: "rrp", message: "RRP seems unreasonably high (max $999)" };
  }
  return null;
}

/** Validates target ACOS is a percentage between 1-100 */
export function validateTargetAcos(acos: number): ValidationError | null {
  if (acos < 1 || acos > 100) {
    return { field: "targetAcos", message: "Target ACOS must be between 1-100%" };
  }
  return null;
}

/** Validates estimated conversion rate is a percentage between 0.1-100 */
export function validateConversionRate(rate: number): ValidationError | null {
  if (rate < 0.1 || rate > 100) {
    return { field: "estConversionRate", message: "Conversion rate must be between 0.1-100%" };
  }
  return null;
}

/** Validates start and end dates */
export function validateDates(
  startDate: string,
  endDate?: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!startDate) {
    errors.push({ field: "startDate", message: "Start date is required" });
    return errors;
  }

  const start = new Date(startDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Allow start date to be today or in future (not past)
  if (start < now) {
    errors.push({
      field: "startDate",
      message: "Start date cannot be in the past",
    });
  }

  if (endDate) {
    const end = new Date(endDate);
    if (end <= start) {
      errors.push({
        field: "endDate",
        message: "End date must be after start date",
      });
    }
    // Max 1 year duration
    const maxEnd = new Date(start);
    maxEnd.setFullYear(maxEnd.getFullYear() + 1);
    if (end > maxEnd) {
      errors.push({
        field: "endDate",
        message: "Campaign duration cannot exceed 1 year",
      });
    }
  }

  return errors;
}

/** Validates keyword text */
export function validateKeyword(text: string): ValidationError | null {
  const trimmed = text.trim().toLowerCase();

  if (!trimmed) {
    return { field: "keyword", message: "Keyword cannot be empty" };
  }

  if (trimmed.length > 80) {
    return { field: "keyword", message: "Keyword cannot exceed 80 characters" };
  }

  // Check for special characters that Amazon doesn't allow
  if (/[<>{}[\]|^`\\]/.test(trimmed)) {
    return { field: "keyword", message: "Keyword contains invalid characters" };
  }

  return null;
}

/** Checks for duplicate keywords (case-insensitive) */
export function checkDuplicateKeywords(keywords: string[]): ValidationError | null {
  const seen = new Set<string>();
  for (const kw of keywords) {
    const normalized = kw.trim().toLowerCase();
    if (seen.has(normalized)) {
      return { field: "keywords", message: `Duplicate keyword: "${kw}"` };
    }
    seen.add(normalized);
  }
  return null;
}

/** Validates author and book title are not empty */
export function validateAuthorAndTitle(
  author: string,
  title: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!author || !author.trim()) {
    errors.push({ field: "author", message: "Author name is required" });
  }

  if (!title || !title.trim()) {
    errors.push({ field: "title", message: "Book title is required" });
  }

  return errors;
}

/** Validates creator initials are 1-3 uppercase letters */
export function validateCreatorInitials(initials: string): ValidationError | null {
  if (!initials) {
    return { field: "creatorInitials", message: "Creator initials are required" };
  }

  if (initials.length > 3) {
    return { field: "creatorInitials", message: "Initials must be 1-3 characters" };
  }

  if (!/^[A-Z]+$/.test(initials)) {
    return {
      field: "creatorInitials",
      message: "Initials must be uppercase letters only",
    };
  }

  return null;
}

/** Validates bid economics are consistent (ad group bid >= keyword bids) */
export function validateBidConsistency(
  adGroupBid: number,
  keywordBids: number[]
): ValidationError | null {
  for (const kbid of keywordBids) {
    if (kbid > adGroupBid) {
      return {
        field: "bidConsistency",
        message: "Ad group default bid must be >= all keyword bids",
      };
    }
  }
  return null;
}

/** Validates match type selection (at least one must be selected) */
export function validateMatchTypes(matchTypes: string[]): ValidationError | null {
  if (!matchTypes || matchTypes.length === 0) {
    return {
      field: "matchTypes",
      message: "Select at least one match type (Broad, Phrase, Exact)",
    };
  }
  return null;
}

/** Validates keyword sources (at least one should be selected) */
export function validateKeywordSources(sources: string[]): ValidationError | null {
  if (!sources || sources.length === 0) {
    return {
      field: "sources",
      message: "Select at least one keyword source",
    };
  }
  return null;
}
