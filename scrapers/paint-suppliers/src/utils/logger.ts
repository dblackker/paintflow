import winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';

export class Logger {
  private logger: winston.Logger;
  private context: string;

  constructor(context: string) {
    this.context = context;
    
    // Ensure logs directory exists
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
          const contextStr = `[${this.context}]`;
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          const stackStr = stack ? `\n${stack}` : '';
          return `${timestamp} ${level.toUpperCase()} ${contextStr} ${message}${metaStr}${stackStr}`;
        })
      ),
      transports: [
        // Console transport
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
        }),
        // File transport
        new winston.transports.File({
          filename: path.join(logsDir, 'scraper.log'),
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
        }),
        // Error file transport
        new winston.transports.File({
          filename: path.join(logsDir, 'error.log'),
          level: 'error',
          maxsize: 10 * 1024 * 1024,
          maxFiles: 5,
        }),
      ],
    });
  }

  debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }

  info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  error(message: string, error?: Error | any, meta?: any): void {
    if (error instanceof Error) {
      this.logger.error(message, { error: error.message, stack: error.stack, ...meta });
    } else {
      this.logger.error(message, { error, ...meta });
    }
  }
}
