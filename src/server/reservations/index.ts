/** Reservation domain API (server only). See docs/pricing-and-cancellation.md for the rules. */
export * from "./errors";
export * from "./policy";
export { quoteReservation, validatePeriod, type ExtraSelection, type QuoteRequest } from "./quote";
export {
  searchVehicles,
  getVehicleBusyIntervals,
  getVehicleAvailabilityCalendar,
  findAvailabilityConflict,
  type SearchVehiclesInput,
  type SearchResult,
  type BusyInterval,
  type CalendarDay,
  type AvailabilityConflict,
} from "./availability";
export { createReservationHold, holdMinutes, type CreateHoldInput, type CreateHoldResult, type ReservationRow } from "./holds";
export {
  payReservation,
  processPaymentEvent,
  settleReservationMoney,
  tryConfirmReservation,
  type PayReservationInput,
  type PayReservationResult,
  type WebhookResult,
} from "./payments";
export { cancelReservation, modifyReservation, previewModification, type Actor, type CancelInput, type CancelResult, type ModifyInput, type ModifyResult } from "./changes";
export {
  checkOut,
  checkIn,
  createDamageReport,
  updateDamageReportStatus,
  listDamageReports,
  getDamageReport,
  type CheckOutInput,
  type CheckInInput,
  type CheckInResult,
  type DamageReportInput,
} from "./operations";
export {
  getReservationDetail,
  listUserReservations,
  listReservations,
  reservationStats,
  type ReservationDetail,
  type ReservationListItem,
  type AdminReservationFilter,
} from "./queries";
