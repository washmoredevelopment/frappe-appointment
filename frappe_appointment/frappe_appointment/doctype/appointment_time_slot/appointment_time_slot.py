# Copyright (c) 2023, rtCamp and contributors
# For license information, please see license.txt

from datetime import datetime
from functools import cmp_to_key

import frappe
from frappe import _
from frappe.integrations.doctype.google_calendar.google_calendar import (
    get_google_calendar_object,
)
from frappe.model.document import Document

from frappe_appointment.helpers.utils import (
    compare_end_time_slots,
    convert_timezone_to_utc,
    get_today_min_max_time,
)


class AppointmentTimeSlot(Document):
    pass


class GoogleBadRequest(Exception):
    pass


def get_all_unavailable_google_calendar_slots_for_day(
    member_time_slots: object,
    starttime: datetime,
    endtime: datetime,
    date: datetime,
    appointment_group: object,
) -> list:
    """Get all google time slots of the given memebers

    Args:
    member_time_slots (object): list  of members
    starttime (datetime): start time for slot
    endtime (datetime): end time for slot
    date (datetime): data for which need to fetch the data
    appointment_group (object): object

    Returns:
    list: List of all google time slots of members
    """
    cal_slots = []

    for member in member_time_slots:
        google_calendar_slots = get_google_calendar_slots_member(member, starttime, endtime, date, appointment_group)

        if google_calendar_slots == False:  # noqa: E712
            return False

        cal_slots = cal_slots + google_calendar_slots

    cal_slots.sort(key=cmp_to_key(compare_end_time_slots))

    return remove_duplicate_slots(cal_slots)


def get_google_calendar_slots_member(
    member: str,
    starttime: datetime,
    endtime: datetime,
    date: datetime,
    appointment_group: object,
) -> list:
    """Fetch the google slots data for given member/user from all their calendars.

    This includes the primary calendar and any linked calendars that have
    'check_for_conflicts' enabled.

    Args:
    member (str): User Appointment Availability name
    starttime (datetime): Start time
    endtime (datetime): end time
    date (datetime): date
    appointment_group (object): object

    Returns:
    list: list of busy slots from all user's calendars
    """

    if not member:
        return []

    # Get the User Appointment Availability document to access all calendars
    try:
        user_availability = frappe.get_doc("User Appointment Availability", member)
    except frappe.DoesNotExistError:
        return []

    if not user_availability.google_calendar:
        return []

    # Collect all calendars to check: primary + linked calendars with check_for_conflicts enabled
    calendars_to_check = [user_availability.google_calendar]

    if user_availability.linked_calendars:
        for linked_cal in user_availability.linked_calendars:
            if linked_cal.check_for_conflicts and linked_cal.calendar:
                calendars_to_check.append(linked_cal.calendar)

    # Aggregate events from all calendars
    all_range_events = []
    time_max, time_min = get_today_min_max_time(date)

    for idx, calendar_id in enumerate(calendars_to_check):
        is_primary = (idx == 0)  # First calendar in the list is the primary
        calendar_events = _fetch_events_from_calendar(
            calendar_id=calendar_id,
            member=member,
            starttime=starttime,
            endtime=endtime,
            time_min=time_min,
            time_max=time_max,
            is_primary=is_primary,
        )

        if calendar_events is False:
            # Error fetching from this calendar - continue with others but log the issue
            frappe.log_error(
                title="Failed to fetch calendar events",
                message=f"Could not fetch events from calendar {calendar_id} for member {member}",
            )
            continue

        if calendar_events:
            all_range_events.extend(calendar_events)

    return all_range_events


def _fetch_events_from_calendar(
    calendar_id: str,
    member: str,
    starttime: datetime,
    endtime: datetime,
    time_min: str,
    time_max: str,
    is_primary: bool = True,
) -> list:
    """Fetch events from a single Google Calendar.

    Args:
    calendar_id (str): Google Calendar doctype name
    member (str): User Appointment Availability name (for filtering events)
    starttime (datetime): Start time for range check
    endtime (datetime): End time for range check
    time_min (str): ISO format time min for Google API
    time_max (str): ISO format time max for Google API
    is_primary (bool): True if this is the primary calendar (applies stricter event filtering)

    Returns:
    list: List of events in range, or False on error
    """
    try:
        google_calendar = frappe.get_doc("Google Calendar", calendar_id)
    except frappe.DoesNotExistError:
        return False

    try:
        google_calendar_api_obj, account = get_google_calendar_object(google_calendar.name)
    except Exception:
        frappe.log_error(
            title="Google Calendar API Error",
            message=f"Could not create Google Calendar API object for {calendar_id}",
        )
        return False

    try:
        events = (
            google_calendar_api_obj.events()
            .list(
                calendarId=google_calendar.google_calendar_id,
                maxResults=2000,
                singleEvents=True,
                timeMax=time_max,
                timeMin=time_min,
                orderBy="startTime",
            )
            .execute()
        )
    except Exception as err:
        error_status = getattr(getattr(err, "resp", None), "status", "unknown")
        frappe.log_error(
            title="Google Calendar Fetch Error",
            message=f"Could not fetch events from {calendar_id}, error: {error_status}",
        )
        return False

    events_items = events.get("items", [])
    range_events = []

    for event in events_items:
        try:
            # For the primary calendar, apply strict attendee filtering (original behavior):
            # - Skip events where user is not the creator AND not an attendee
            # For linked/external calendars, include all events as busy
            creator = event.get("creator", {}).get("email")
            if creator != member:
                attendees = event.get("attendees", [])
                filtered_attendees = [attendee for attendee in attendees if attendee.get("self", False)]

                if len(filtered_attendees) > 0:
                    attendee = filtered_attendees[0]

                    if attendee.get("responseStatus") == "declined":
                        continue
                else:
                    # For primary calendar: skip if not creator and not an attendee (original behavior)
                    # For linked calendars: include all events (they block availability)
                    if is_primary:
                        continue

            if check_if_datetime_in_range(
                convert_timezone_to_utc(event["start"]["dateTime"], event["start"]["timeZone"]),
                convert_timezone_to_utc(event["end"]["dateTime"], event["end"]["timeZone"]),
                starttime,
                endtime,
            ):
                range_events.append(event)
        except Exception:
            # Handle all-day events which don't have timeZone
            if "timeZone" not in event.get("start", {}) and google_calendar.custom_ignore_all_day_events:
                pass
            else:
                return False

    return range_events


def remove_duplicate_slots(cal_slots: list):
    """Remove duplicate from google slots

    Args:
    cal_slots (list): List of time slots

    Returns:
    _type_: List of time slots
    """
    if len(cal_slots) <= 1:
        return cal_slots

    current = 1
    last = 0
    remove_duplicate_time_slots = []

    remove_duplicate_time_slots.append(cal_slots[last])

    while current < len(cal_slots):
        last_start = convert_timezone_to_utc(cal_slots[last]["start"]["dateTime"], cal_slots[last]["start"]["timeZone"])
        last_end = convert_timezone_to_utc(cal_slots[last]["end"]["dateTime"], cal_slots[last]["end"]["timeZone"])
        current_start = convert_timezone_to_utc(
            cal_slots[current]["start"]["dateTime"],
            cal_slots[current]["start"]["timeZone"],
        )
        current_end = convert_timezone_to_utc(
            cal_slots[current]["end"]["dateTime"], cal_slots[current]["end"]["timeZone"]
        )

        if current_start == last_start and current_end == last_end:
            current += 1
            continue

        remove_duplicate_time_slots.append(cal_slots[current])
        last = current
        current += 1

    return remove_duplicate_time_slots


def is_busy_event(event: object, availability: object, user: str):
    if (
        not availability.get("calendars")
        or not availability["calendars"].get(user)
        or availability["calendars"][user].get("errors")
    ):
        # If error then assume the slot as busy only
        return True

    busy_array = availability["calendars"][user]["busy"]

    start_utc = convert_timezone_to_utc(event["start"]["dateTime"], event["start"]["timeZone"])
    end_utc = convert_timezone_to_utc(event["end"]["dateTime"], event["end"]["timeZone"])

    for busy in busy_array:
        if datetime.fromisoformat(busy["start"]) == start_utc and datetime.fromisoformat(busy["end"]) == end_utc:
            return True

    return False


def check_if_datetime_in_range(
    start_datetime: datetime,
    end_datetime: datetime,
    lower_datetime: datetime,
    upper_datetime: datetime,
):
    """Check if [start_datetime, end_datetime] (s1) has an intersection with [lower_datetime, upper_datetime] (r1).

    Args:
    start_datetime (datetime): Start Datetime
    end_datetime (datetime): End Datetime
    lower_datetime (datetime): Lower Datetime (Start time of range)
    upper_datetime (datetime): Upper Datetime (End time of range)

    Returns:
    bool: True if s1 has overlap with r1, False otherwise.
    """

    # if lower_datetime <= start_datetime and end_datetime <= upper_datetime:
    # 	return True

    # if end_datetime > lower_datetime and lower_datetime > start_datetime:
    # 	return True

    # if start_datetime < upper_datetime and upper_datetime < end_datetime:
    # 	return True

    if lower_datetime > end_datetime or upper_datetime < start_datetime:
        return False

    return True
