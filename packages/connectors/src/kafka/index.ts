// ===========================================
// Kafka Connector Exports
// ===========================================

export { KafkaReceiver, toRawMessage as kafkaRecordToRawMessage, type KafkaReceiverConfig } from './kafka-receiver.js';
export { KafkaDispatcher, type KafkaDispatcherConfig } from './kafka-dispatcher.js';
export {
  KAFKA_SASL_MECHANISM,
  subscribeKafka,
  createKafkaProducer,
  testKafkaConnection,
  parseBrokers,
  type KafkaSaslMechanism,
  type KafkaConnectionConfig,
  type KafkaInboundRecord,
  type KafkaSubscription,
  type KafkaSubscribe,
  type KafkaSubscribeOptions,
  type KafkaOutboundRecord,
  type KafkaWriteResult,
  type KafkaProducerClient,
  type KafkaProducerFactory,
} from './kafka-client.js';
