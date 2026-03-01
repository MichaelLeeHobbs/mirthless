// ===========================================
// File Connector Exports
// ===========================================

export {
  FileReceiver,
  matchGlob,
  FILE_SORT_BY,
  FILE_POST_ACTION,
  type FileReceiverConfig,
  type FileSortBy,
  type FilePostAction,
} from './file-receiver.js';

export {
  FileDispatcher,
  resolveOutputFilename,
  type FileDispatcherConfig,
} from './file-dispatcher.js';
