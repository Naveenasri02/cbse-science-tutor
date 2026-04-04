export const LIMITS = {
  maxUploadSize: 50 * 1024 * 1024, // 50 MB
  allowedExtensions: ['.pdf', '.docx', '.doc', '.txt', '.md', '.csv', '.pptx', '.xlsx'],
  maxConversationTurns: 20,
  tokenBudget: 12000,
  maxResponseTokens: 4096,
  chunkSize: 300,
  chunkOverlap: 30,
  ragTopK: 10,
};
