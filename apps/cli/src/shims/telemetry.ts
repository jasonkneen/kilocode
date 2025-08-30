export class TelemetryService {
	static instance = new TelemetryService()
	captureEvent(_name: any, _props?: any) {}
	captureSchemaValidationError(_args: any) {}
	captureTaskCreated(_taskId: string) {}
	captureTaskRestarted(_taskId: string) {}
}

export default { TelemetryService }
