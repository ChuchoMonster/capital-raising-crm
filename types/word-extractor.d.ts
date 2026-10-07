/**
 * word-extractor ships no types.
 *
 * Only what this project calls is declared, deliberately: a fuller guess at the
 * library's shape would be a fiction the compiler then enforces.
 */
declare module "word-extractor" {
  class Document {
    getBody(): string;
    getFootnotes(): string;
    getHeaders(): string;
  }
  export default class WordExtractor {
    extract(input: string | Buffer): Promise<Document>;
  }
}
