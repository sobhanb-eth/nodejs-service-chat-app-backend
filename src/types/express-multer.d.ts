import { Request } from 'express';

declare global {
  namespace Express {
    namespace Multer {
      interface File {
        /** Field name specified in the form */
        fieldname: string;
        /** Name of the file on the user's computer */
        originalname: string;
        /** Encoding type of the file */
        encoding: string;
        /** Mime type of the file */
        mimetype: string;
        /** Size of the file in bytes */
        size: number;
        /** The folder to which the file has been saved (DiskStorage) */
        destination?: string;
        /** The name of the file within the destination (DiskStorage) */
        filename?: string;
        /** Location of the uploaded file (DiskStorage) */
        path?: string;
        /** A Buffer of the entire file (MemoryStorage) */
        buffer?: Buffer;
      }
    }

    interface Request {
      /** `Multer.File` object populated by `single()` middleware. */
      file?: Multer.File;
      /**
       * Array or dictionary of `Multer.File` object populated by `array()`,
       * `fields()` middleware.
       */
      files?: Multer.File[] | { [fieldname: string]: Multer.File[] };
    }
  }
}

// Multer module types
declare module 'multer' {
  interface Options {
    /** The destination directory for the uploaded files. */
    dest?: string;
    /** The storage engine to use for uploaded files. */
    storage?: StorageEngine;
    /** An object specifying the size limits of the following optional properties. */
    limits?: {
      /** Max field name size (Default: 100 bytes) */
      fieldNameSize?: number;
      /** Max field value size (Default: 1MB) */
      fieldSize?: number;
      /** Max number of non- file fields (Default: Infinity) */
      fields?: number;
      /** For multipart forms, the max file size (in bytes)(Default: Infinity) */
      fileSize?: number;
      /** For multipart forms, the max number of file fields (Default: Infinity) */
      files?: number;
      /** For multipart forms, the max number of parts (fields + files)(Default: Infinity) */
      parts?: number;
      /** For multipart forms, the max number of header key=> value pairs to parse Default: 2000(same as node's http). */
      headerPairs?: number;
    };
    /** Keep the full path of files instead of just the base name (Default: false) */
    preservePath?: boolean;
    /** A function to control which files to upload and which to skip. */
    fileFilter?: (req: Express.Request, file: Express.Multer.File, callback: (error: Error | null, acceptFile: boolean) => void) => void;
  }

  interface StorageEngine {
    _handleFile(req: Express.Request, file: Express.Multer.File, callback: (error?: any, info?: Partial<Express.Multer.File>) => void): void;
    _removeFile(req: Express.Request, file: Express.Multer.File, callback: (error: Error | null) => void): void;
  }

  interface DiskStorageOptions {
    /** A function used to determine within which folder the uploaded files should be stored. */
    destination?: string | ((req: Express.Request, file: Express.Multer.File, callback: (error: Error | null, destination: string) => void) => void);
    /** A function used to determine what the file should be named inside the folder. */
    filename?: (req: Express.Request, file: Express.Multer.File, callback: (error: Error | null, filename: string) => void) => void;
  }

  interface Instance {
    /** Accept a single file with the name fieldname. The single file will be stored in req.file. */
    single(fieldname?: string): RequestHandler;
    /** Accept an array of files, all with the name fieldname. Optionally error out if more than maxCount files are uploaded. The array of files will be stored in req.files. */
    array(fieldname: string, maxCount?: number): RequestHandler;
    /** Accept a mix of files, specified by fields. An object with arrays of files will be stored in req.files. */
    fields(fields: Field[]): RequestHandler;
    /** Accepts all files that comes over the wire. An array of files will be stored in req.files. */
    any(): RequestHandler;
    /** Accept only text fields. If any file upload is made, error with code "LIMIT_UNEXPECTED_FILE" will be issued. This is the same as doing upload.fields([]). */
    none(): RequestHandler;
  }

  interface Field {
    /** The field name. */
    name: string;
    /** Optional maximum number of files per field to accept. */
    maxCount?: number;
  }

  interface MulterError extends Error {
    /** Name of the MulterError */
    name: string;
    /** A string corresponding to the error code */
    code: string;
    /** A string corresponding to the error field */
    field?: string;
  }

  /** Returns a Multer instance that provides several methods for generating middleware that process files uploaded in multipart/form-data format. */
  function multer(options?: Options): Instance;

  namespace multer {
    function diskStorage(options: DiskStorageOptions): StorageEngine;
    function memoryStorage(): StorageEngine;
    const MulterError: MulterError;
  }

  export = multer;
}

export {};
