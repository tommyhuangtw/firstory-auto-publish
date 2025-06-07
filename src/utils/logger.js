class Logger {
  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'info';
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    let logMsg = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    if (data) {
      logMsg += ` ${JSON.stringify(data, null, 2)}`;
    }
    
    return logMsg;
  }

  info(message, data = null) {
    console.log(this.formatMessage('info', message, data));
  }

  error(message, data = null) {
    console.error(this.formatMessage('error', message, data));
  }

  warn(message, data = null) {
    console.warn(this.formatMessage('warn', message, data));
  }

  debug(message, data = null) {
    if (this.logLevel === 'debug') {
      console.log(this.formatMessage('debug', message, data));
    }
  }
}

module.exports = { Logger };