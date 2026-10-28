package com.coalaone.go.data

import kotlinx.serialization.Serializable

// Ponto: the same answers the web "Registro de ponto" reads (/api/dp/time-recording/*).
/** `timeZone` null: the unit follows the establishment zone given by the official clock. */
@Serializable data class LocationPolicy(val mode: String = "disabled", val revision: Int = 0,
    val captureTimeoutMs: Long? = null, val maxAccuracyMeters: Double? = null, val privacyNoticeUrl: String? = null)
@Serializable data class ExecutionUnit(val id: String, val name: String, val employer: Boolean = false, val timeZone: String? = null,
    val locationPolicy: LocationPolicy = LocationPolicy())
/** Official time checked against Hora Legal; it may be display-only, while a punch still requires every other gate. */
@Serializable data class OfficialClock(val available: Boolean, val instant: String? = null, val timeZone: String? = null, val issue: String? = null)
@Serializable data class TimeOptions(val workDate: String, val eligible: Boolean, val markingEnabled: Boolean,
    val executionUnits: List<ExecutionUnit>, val officialClock: OfficialClock? = null, val journeyLocationEnabled: Boolean = false,
    val mode: String = "official")
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable data class OfflinePermitRequest(val permitRequestId: String, val workDate: String, val installationId: String,
    val deviceKeyId: String, val devicePublicKey: String, val keySecurity: String, val bootCount: Int, val anchorElapsedRealtimeMs: Long,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val protocolVersion: Int? = null)
@Serializable data class OfflinePermitUnit(val id: String, val name: String, val timeZone: String)
@Serializable data class OfflinePermit(val permitId: String, val installationId: String, val deviceKeyId: String, val keySecurity: String,
    val bootCount: Int, val anchorElapsedRealtimeMs: Long, val anchorInstant: String, val issuedAt: String, val expiresAt: String,
    val units: List<OfflinePermitUnit>, val scope: String = "official", val protocolVersion: Int? = null,
    val preparationExpiresAt: String? = null, val cycle: OfflineCycle? = null)
@Serializable data class OfflineCycleEvidence(val id: String, val startedElapsedRealtimeMs: Long)
@Serializable data class OfflineCycle(val id: String, val startedAt: String, val expiresAt: String,
    val startedElapsedRealtimeMs: Long? = null, val permitId: String? = null, val status: String = "active",
    val lastReceiptId: String? = null, val lastElapsedRealtimeMs: Long? = null)
@Serializable data class OfflineCycleAction(val action: String, val scope: String, val permitId: String, val cycleId: String,
    val startedElapsedRealtimeMs: Long, val elapsedRealtimeMs: Long, val bootCount: Int, val deviceKeyId: String,
    val receiptId: String, val lastSequence: Int, val signature: String)
@Serializable data class OfflineCycleResponse(val cycle: OfflineCycle, val status: String)
@Serializable data class OfflinePermitResponse(val permit: OfflinePermit)
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable data class OfflineMarkingEvidence(val permitId: String, val deviceKeyId: String, val elapsedRealtimeMs: Long,
    val bootCount: Int, val sequence: Int, val previousLocalHash: String? = null, val markedAt: String,
    val localHash: String, val signature: String,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val scope: String = "official",
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val cycle: OfflineCycleEvidence? = null)
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable data class MarkingRequest(val attemptId: String, val workDate: String, val executionUnitId: String, val channel: String = "mobile",
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val declaredPurpose: String? = null,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val offline: OfflineMarkingEvidence? = null,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val locationAttempt: LocationAttempt? = null,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val onlineScope: String? = null)
@Serializable data class LocationAttempt(val captureId: String, val status: String, val elapsedMs: Long,
    val capturedAt: String? = null, val latitude: Double? = null, val longitude: Double? = null, val accuracyMeters: Double? = null)
@Serializable data class LocationSummary(val captureStatus: String, val evaluation: String)
@Serializable data class RecordedMarking(val nsr: Long, val markedAt: String, val executionUnitId: String)
@Serializable data class MarkingResponse(val status: String, val receiptId: String, val receiptStatus: String, val receiptIssue: String? = null,
    val marking: RecordedMarking, val location: LocationSummary? = null, val pilot: Boolean = false, val offlineCycle: OfflineCycle? = null)
@Serializable data class MarkingClassification(val purpose: String, val source: String = "declared", val status: String = "confirmed")
@Serializable data class OwnMarking(val receiptId: String, val workDate: String, val nsr: Long, val markedAt: String, val executionUnitId: String, val collectorId: String, val receiptStatus: String, val receiptIssue: String? = null,
    val classification: MarkingClassification? = null, val pilot: Boolean = false)
@Serializable data class ClassificationUpdate(val purpose: String)
@Serializable data class ClassificationResult(val classification: MarkingClassification, val changeStatus: String = "applied")
@Serializable data class OwnMarkings(val startDate: String, val endDate: String, val markings: List<OwnMarking>, val truncated: Boolean = false)
@Serializable data class BreakSegment(val start: String, val end: String)
@Serializable data class OwnShift(val date: String, val type: String, val startTime: String? = null, val endTime: String? = null, val overnight: Boolean = false, val unitId: String? = null, val unitName: String? = null, val shiftName: String? = null,
    val assignmentKind: String = "regular",
    val breakType: String? = null, val breakStart: String? = null, val breakEnd: String? = null, val breakDurationMinutes: Int? = null, val breakWindowStart: String? = null, val breakWindowEnd: String? = null,
    val breakSegments: List<BreakSegment>? = null, val breakSplit: String? = null, val breakPauseCount: Int? = null, val breakMinPauseMinutes: Int? = null,
    val toleranceMinutes: Int? = null, val expectedPunches: Int? = null,
    val executionUnitPolicy: String = "scheduled", val locationTrackingPolicy: String = "punch_only", val unitTimeZone: String? = null)
@Serializable data class OwnMonth(val month: String, val shifts: List<OwnShift>, val truncated: Boolean = false)

/** Privacy-separated journey trail. It never changes a punch, NSR, receipt, AFD or payroll result. */
@Serializable data class JourneyLocationEvent(val eventId: String, val sessionId: String, val workDate: String,
    val executionUnitId: String, val eventType: String, val capturedAt: String,
    val latitude: Double? = null, val longitude: Double? = null, val accuracyMeters: Double? = null)
@Serializable data class JourneyLocationBatch(val events: List<JourneyLocationEvent>)
@Serializable data class JourneyLocationAccepted(val acceptedEventIds: List<String>, val stopRequested: Boolean = false)

@Serializable data class AdjustmentTarget(val receiptId: String, val nsr: Long? = null, val pilotSequence: Long? = null, val markedAt: String, val executionUnitId: String)
@Serializable data class AdjustmentInclusion(val markedAt: String, val executionUnitId: String)
@Serializable data class AdjustmentAct(val action: String, val role: String, val at: String, val reason: String? = null)
@Serializable data class AdjustmentOperation(val kind: String, val target: AdjustmentTarget? = null, val inclusion: AdjustmentInclusion? = null)
@Serializable data class Adjustment(val id: String, val workDate: String, val kind: String, val status: String, val version: Int, val target: AdjustmentTarget? = null, val inclusion: AdjustmentInclusion? = null,
    val operations: List<AdjustmentOperation> = emptyList(), val reason: String, val acts: List<AdjustmentAct> = emptyList(), val createdAt: String, val decidedAt: String? = null,
    val scope: String = "official")
@Serializable data class Treatment(val id: String, val adjustmentId: String, val workDate: String, val type: String, val originalReceiptId: String? = null, val markedAt: String? = null, val executionUnitId: String? = null)
@Serializable data class OwnAdjustments(val adjustments: List<Adjustment>, val treatments: List<Treatment> = emptyList())
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable data class AdjustmentRequestOperation(val kind: String,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val targetReceiptId: String? = null,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val newTime: String? = null,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val executionUnitId: String? = null)
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable data class AdjustmentRequest(val attemptId: String, val workDate: String, val operations: List<AdjustmentRequestOperation>, val reason: String,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val scope: String? = null)
@Serializable data class AdjustmentCreated(val adjustment: Adjustment)

// Banco e espelho: consultas pessoais, sem ações de DP no aplicativo.
@Serializable data class TimeBankPolicy(val id: String, val version: Int, val name: String = "Política de banco de horas", val enabled: Boolean = false)
@Serializable data class TimeBankCycle(val start: String, val end: String, val index: Int)
@Serializable data class TimeBankLineValue(val nature: String, val minutes: Int, val reason: String, val categoryId: String? = null, val ratePercent: Double? = null)
@Serializable data class TimeBankStatementLine(val date: String, val competence: String, val closureVersion: Int, val line: TimeBankLineValue)
@Serializable data class TimeBankLimits(val positiveExceeded: Boolean = false, val negativeExceeded: Boolean = false, val negativeNotAllowed: Boolean = false)
@Serializable data class TimeBankStatement(val cycle: TimeBankCycle? = null, val openingMinutes: Int = 0, val balanceMinutes: Int = 0,
    val credit: Int = 0, val debit: Int = 0, val payroll: Int = 0, val discount: Int = 0, val review: Int = 0, val nightMinutes: Int = 0,
    val lines: List<TimeBankStatementLine> = emptyList(), val missing: List<String> = emptyList(), val ended: Boolean = false,
    val settlementOutdated: Boolean = false, val limits: TimeBankLimits = TimeBankLimits())
@Serializable data class TimeBankResponse(val policy: TimeBankPolicy? = null, val statement: TimeBankStatement? = null, val previewCompetences: List<String> = emptyList())

@Serializable data class ClosureStatus(val status: String, val version: Int)
@Serializable data class MirrorFileStatus(val snapshotHash: String, val generatedAt: String)
@Serializable data class ClosingPackageStatus(val status: String, val sentAt: String? = null, val signedAt: String? = null)
@Serializable data class MirrorStatus(val competence: String, val closure: ClosureStatus? = null, val mirror: MirrorFileStatus? = null,
    val `package`: ClosingPackageStatus? = null)
@Serializable data class MirrorGenerateRequest(val action: String = "generate", val competence: String, val expectedVersion: Int)
@Serializable data class MirrorGenerated(val mirror: MirrorFileStatus)

// Solicitações: ausência, vale-transporte e troca de turno usam os mesmos contratos centrais da web.
@Serializable data class AbsenceOption(val id: String, val name: String, val units: List<String>, val attachmentRequired: Boolean = false, val validFrom: String? = null, val validTo: String? = null)
@Serializable data class AbsenceCapabilities(val canCreate: Boolean = false)
@Serializable data class AbsenceOptions(val absenceTypes: List<AbsenceOption>, val capabilities: AbsenceCapabilities? = null)
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable data class AbsencePeriod(val absenceTypeId: String, val startDate: String, val endDate: String, val unit: String,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val startTime: String? = null,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val endTime: String? = null)
@Serializable data class PreviewQuantity(val value: Double? = null, val unit: String, val calculation: String? = null)
@Serializable data class PreviewPeriod(val startDate: String, val endDate: String, val startTime: String? = null, val endTime: String? = null)
@Serializable data class PreviewType(val id: String, val name: String)
@Serializable data class AbsencePreview(val absenceType: PreviewType, val period: PreviewPeriod, val quantity: PreviewQuantity, val tacitApprovalDays: Int? = null, val attachmentRequired: Boolean = false, val instructions: String? = null)
@Serializable data class AbsencePreviewResponse(val preview: AbsencePreview)
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable data class AbsenceDraftRequest(val idempotencyKey: String,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val proposedRequestId: String? = null,
    val request: AbsencePeriod, val preparationIds: List<String> = emptyList(),
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val reason: String? = null)
@Serializable data class AbsenceSubmit(val expectedVersion: Int, val operationId: String, val action: String = "submit")
@Serializable data class AbsencePreparation(val proposedRequestId: String, val preparationIds: List<String>)
@Serializable data class AbsenceInput(val startDate: String, val endDate: String, val startTime: String? = null, val endTime: String? = null)
@Serializable data class AbsenceRequestRow(val id: String, val status: String, val version: Int, val typeName: String, val input: AbsenceInput, val quantity: Double? = null, val unit: String, val reason: String? = null, val approvedByInaction: Boolean = false, val createdAt: String, val submittedAt: String? = null)
@Serializable data class AbsenceRequestEnvelope(val request: AbsenceRequestRow)
@Serializable data class AbsenceRequests(val requests: List<AbsenceRequestRow>, val nextCursor: String? = null)

@Serializable data class VoucherRequestCreate(val action: String, val details: String = "")
@Serializable data class VoucherReview(val reviewerName: String? = null, val reviewedAt: String? = null, val notes: String? = null)
@Serializable data class VoucherRequest(val id: String, val action: String, val status: String, val details: String = "", val requestDate: String, val effectiveDate: String? = null, val requestedAfterCutoff: Boolean = false, val review: VoucherReview? = null, val createdAt: String)
@Serializable data class VoucherRequests(val requests: List<VoucherRequest>)
@Serializable data class VoucherCreated(val request: VoucherRequest)

@Serializable data class ShiftSwapOption(val scheduleId: String, val shiftId: String, val unitId: String, val unitName: String, val date: String,
    val startTime: String, val endTime: String, val shiftDefinitionId: String? = null, val shiftName: String? = null, val occupantUid: String, val occupantName: String)
@Serializable data class ShiftSwapOptions(val ownShifts: List<ShiftSwapOption> = emptyList(), val candidateShifts: List<ShiftSwapOption> = emptyList(), val through: String)
@Serializable data class ShiftSwapShift(val scheduleId: String, val shiftId: String, val unitId: String, val unitName: String, val date: String,
    val startTime: String, val endTime: String, val shiftDefinitionId: String? = null, val shiftName: String? = null, val occupantUid: String, val occupantName: String)
@Serializable data class ShiftSwapEvidence(val authenticatedUid: String, val authenticatedEmail: String? = null, val actorName: String,
    val authTime: String? = null, val signInProvider: String? = null, val ipAddress: String? = null, val userAgent: String? = null, val operationId: String)
@Serializable data class ShiftSwapEvent(val action: String, val at: String, val actorUid: String, val actorName: String, val declaration: String, val evidence: ShiftSwapEvidence)
@Serializable data class ShiftSwapViewerActions(val accept: Boolean = false, val reject: Boolean = false, val cancel: Boolean = false)
@Serializable data class ShiftSwapRequest(val id: String, val status: String, val version: Int, val requesterUid: String, val requesterName: String,
    val targetUid: String, val targetName: String, val offeredShift: ShiftSwapShift, val requestedShift: ShiftSwapShift, val reason: String? = null,
    val events: List<ShiftSwapEvent> = emptyList(), val createdAt: String, val updatedAt: String, val decidedAt: String? = null,
    val viewerActions: ShiftSwapViewerActions = ShiftSwapViewerActions())
@Serializable data class ShiftSwapRequests(val requests: List<ShiftSwapRequest> = emptyList())
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable data class ShiftSwapCreate(val scheduleId: String, val offeredShiftId: String, val requestedShiftId: String, val operationId: String,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val reason: String? = null)
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable data class ShiftSwapDecision(val action: String, val expectedVersion: Int, val operationId: String,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val reason: String? = null)
@Serializable data class ShiftSwapCreated(val request: ShiftSwapRequest)
