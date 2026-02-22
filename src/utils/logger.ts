import { createLogger, format, transports } from 'winston';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

export const logger = createLogger({
  level: LOG_LEVEL,
  format: format.combine(
    format.timestamp({ format: 'HH:mm:ss' }),
    format.colorize(),
    format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [
    new transports.Console(),
    new transports.File({
      filename: 'agent-wallet.log',
      format: format.combine(format.timestamp(), format.json()),
    }),
  ],
});
