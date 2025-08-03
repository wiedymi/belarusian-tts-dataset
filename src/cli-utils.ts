import ora from 'ora';
import chalk from 'chalk';
import boxen from 'boxen';

export function createHeader(title: string, subtitle?: string): string {
  const asciiLogo = `
 ██████╗ ███████╗██╗      █████╗ ██████╗ ██╗   ██╗███████╗
 ██╔══██╗██╔════╝██║     ██╔══██╗██╔══██╗██║   ██║██╔════╝
 ██████╔╝█████╗  ██║     ███████║██████╔╝██║   ██║███████╗
 ██╔══██╗██╔══╝  ██║     ██╔══██║██╔══██╗██║   ██║╚════██║
 ██████╔╝███████╗███████╗██║  ██║██║  ██║╚██████╔╝███████║
 ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝
                                                            
        ████████╗████████╗███████╗                         
        ╚══██╔══╝╚══██╔══╝██╔════╝                         
           ██║      ██║   ███████╗                         
           ██║      ██║   ╚════██║                         
           ██║      ██║   ███████║                         
           ╚═╝      ╚═╝   ╚══════╝                         
`;

  const divider = '═'.repeat(60);
  const content = `${asciiLogo}\n${divider}\n\n${title}\n${subtitle || ''}\n\n${divider}`;
  return chalk.cyan(content);
}

export function formatSection(title: string): string {
  return chalk.bold(`\n${title}\n${'─'.repeat(title.length)}`);
}

export function formatInfo(label: string, value: string | number): string {
  return `${chalk.dim(label)}: ${chalk.white(value)}`;
}

export function formatSuccess(message: string, indent: number = 0): string {
  return ' '.repeat(indent) + chalk.green(`[OK] ${message}`);
}

export function formatError(message: string, indent: number = 0): string {
  return ' '.repeat(indent) + chalk.red(`[ERROR] ${message}`);
}

export function formatWarning(message: string, indent: number = 0): string {
  return ' '.repeat(indent) + chalk.yellow(`[WARN] ${message}`);
}

export function formatListItem(item: string, indent: number = 0): string {
  return ' '.repeat(indent) + chalk.dim('•') + ' ' + item;
}

export class CLISpinner {
  private spinner: any;
  
  start(text: string): void {
    this.spinner = ora({
      text,
      spinner: 'dots'
    }).start();
  }
  
  update(text: string): void {
    if (this.spinner) {
      this.spinner.text = text;
    }
  }
  
  succeed(text?: string): void {
    if (this.spinner) {
      this.spinner.succeed(text);
    }
  }
  
  fail(text?: string): void {
    if (this.spinner) {
      this.spinner.fail(text);
    }
  }
  
  warn(text?: string): void {
    if (this.spinner) {
      this.spinner.warn(text);
    }
  }
  
  stop(): void {
    if (this.spinner) {
      this.spinner.stop();
    }
  }
}

export class CLIProgress {
  private total: number;
  private current: number = 0;
  private startTime: number;
  private spinner: any;
  private lastMessage: string = '';
  private isActive: boolean = true;
  
  constructor(total: number, description: string) {
    this.total = total;
    this.startTime = Date.now();
    this.lastMessage = description;
    this.spinner = ora({
      text: this.getProgressText(description),
      spinner: 'dots'
    }).start();
  }
  
  update(current: number, description?: string): void {
    this.current = current;
    if (description) this.lastMessage = description;
    if (this.isActive && this.spinner) {
      this.spinner.text = this.getProgressText(this.lastMessage);
    }
  }
  
  log(message: string): void {
    if (!this.isActive) {
      console.log(message);
      return;
    }
    
    // Clear the spinner line
    this.spinner.clear();
    // Print the message
    console.log(message);
    // Render the spinner on a new line
    this.spinner.render();
  }
  
  private getProgressText(description?: string): string {
    const percentage = Math.round((this.current / this.total) * 100);
    const elapsed = Date.now() - this.startTime;
    const rate = this.current / (elapsed / 1000);
    const remaining = rate > 0 ? (this.total - this.current) / rate : 0;
    
    const progressBar = this.createProgressBar(percentage);
    const eta = this.formatTime(remaining);
    
    const text = description || 'Processing';
    return `${text} ${progressBar} ${percentage}% (${this.current}/${this.total}) ETA: ${eta}`;
  }
  
  private createProgressBar(percentage: number): string {
    const width = 30;
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
  }
  
  private formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  
  complete(message?: string): void {
    this.isActive = false;
    this.spinner.succeed(message || 'Complete');
  }
  
  fail(message?: string): void {
    this.isActive = false;
    this.spinner.fail(message || 'Failed');
  }
  
  pause(): void {
    if (this.spinner && this.isActive) {
      this.spinner.stop();
    }
  }
  
  resume(): void {
    if (this.isActive) {
      this.spinner.start();
    }
  }
}