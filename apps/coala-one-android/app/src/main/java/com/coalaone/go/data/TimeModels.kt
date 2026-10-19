package com.coalaone.go.data

import kotlinx.serialization.Serializable

// Ponto: the same answers the web "Registro de ponto" reads (/api/dp/time-recording/*).
/** `timeZone` null: the unit follows the establishment zone given by the official clock. */
@Serializable data class ExecutionUnit(val id: String, val name: String, val employer: Boolean = false, val timeZone: String? = null)
/** Official time checked against Hora Legal; unavailable blocks the punch on the server too. */
@Serializable data class OfficialClock(val available: Boolean, val instant: String? = null, val timeZone: String? = null, val issue: String? = null)
@Serializable data class TimeOptions(val workDate: String, val eligible: Boolean, val markingEnabled: Boolean, val executionUnits: List<ExecutionUnit>, val officialClock: OfficialClock? = null)
@Serializable data class MarkingRequest(val attemptId: String, val workDate: String, val executionUnitId: String, val channel: String = "mobile")
@Serializable data class RecordedMarking(val nsr: Long, val markedAt: String, val executionUnitId: String)
@Serializable data class MarkingResponse(val status: String, val receiptId: String, val receiptStatus: String, val receiptIssue: String? = null, val marking: RecordedMarking)
@Serializable data class OwnMarking(val receiptId: String, val workDate: String, val nsr: Long, val markedAt: String, val executionUnitId: String, val collectorId: String, val receiptStatus: String, val receiptIssue: String? = null)
@Serializable data class OwnMarkings(val startDate: String, val endDate: String, val markings: List<OwnMarking>, val truncated: Boolean = false)
@Serializable data class BreakSegment(val start: String, val end: String)
@Serializable data class OwnShift(val date: String, val type: String, val startTime: String? = null, val endTime: String? = null, val overnight: Boolean = false, val unitId: String? = null, val unitName: String? = null, val shiftName: String? = null,
    val breakType: String? = null, val breakStart: String? = null, val breakEnd: String? = null, val breakDurationMinutes: Int? = null, val breakWindowStart: String? = null, val breakWindowEnd: String? = null,
    val breakSegments: List<BreakSegment>? = null, val breakSplit: String? = null, val breakPauseCount: Int? = null, val expectedPunches: Int? = null)
@Serializable data class OwnMonth(val month: String, val shifts: List<OwnShift>, val truncated: Boolean = false)

@Serializable data class AdjustmentTarget(val receiptId: String, val nsr: Long, val markedAt: String, val executionUnitId: String)
@Serializable data class AdjustmentInclusion(val markedAt: String, val executionUnitId: String)
@Serializable data class AdjustmentAct(val action: String, val role: String, val at: String, val reason: String? = null)
@Serializable data class Adjustment(val id: String, val workDate: String, val kind: String, val status: String, val version: Int, val target: AdjustmentTarget? = null, val inclusion: AdjustmentInclusion? = null, val reason: String, val acts: List<AdjustmentAct> = emptyList(), val createdAt: String, val decidedAt: String? = null)
@Serializable data class Treatment(val id: String, val adjustmentId: String, val workDate: String, val type: String, val originalReceiptId: String? = null, val markedAt: String? = null, val executionUnitId: String? = null)
@Serializable data class OwnAdjustments(val adjustments: List<Adjustment>, val treatments: List<Treatment> = emptyList())
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable data class AdjustmentRequest(val attemptId: String, val workDate: String, val kind: String,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val targetReceiptId: String? = null,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val newTime: String? = null,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val executionUnitId: String? = null,
    val reason: String)
@Serializable data class AdjustmentCreated(val adjustment: Adjustment)

// Solicitações: ausência (/api/collaborator/absence-requests) e vale-transporte (/api/collaborator/requests).
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
