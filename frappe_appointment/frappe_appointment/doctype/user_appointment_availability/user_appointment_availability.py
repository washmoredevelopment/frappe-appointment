# Copyright (c) 2023, rtCamp and contributors
# For license information, please see license.txt

import re
from datetime import datetime

import frappe
import frappe.utils
from frappe.model.document import Document
from frappe.utils.data import add_to_date

from frappe_appointment.constants import APPOINTMENT_TIME_SLOT
from frappe_appointment.helpers.intervals import find_intersection_interval
from frappe_appointment.helpers.utils import (
    convert_datetime_to_utc,
    convert_utc_datetime_to_timezone,
    get_weekday,
    update_time_of_datetime,
)

SLUG_REGEX = re.compile(r"^[a-z0-9_]+(?:-[a-z0-9_]+)*$")


class UserAppointmentAvailability(Document):
    def validate(self):
        self.validate_time_slots()
        self.validate_primary_calendar()
        self.validate_linked_calendars()
        self.validate_slug()
        self.validate_zoom_settings()

    def validate_time_slots(self):
        """Validate time slots: start time < end time, and weekdays are unique."""
        if self.appointment_time_slot:
            weekdays = []
            for slot in self.appointment_time_slot:
                start_time = datetime.strptime(slot.start_time, "%H:%M:%S")
                end_time = datetime.strptime(slot.end_time, "%H:%M:%S")
                if start_time > end_time:
                    frappe.throw(frappe._("Start time should be less than end time for the day {0}").format(slot.day))
                if slot.day in weekdays:
                    frappe.throw(
                        frappe._("Day {0} is repeated in the time slots. Make sure each day is unique.").format(
                            slot.day
                        )
                    )
                weekdays.append(slot.day)

    def validate_primary_calendar(self):
        """Validate that the primary Google Calendar is authorized."""
        calendar = frappe.get_doc("Google Calendar", self.google_calendar)
        if not calendar.custom_is_google_calendar_authorized:
            frappe.throw(frappe._("Please authorize Google Calendar before creating appointment availability."))

    def validate_linked_calendars(self):
        """Validate linked calendars: no duplicates and all are authorized."""
        if not self.linked_calendars:
            return

        seen_calendars = {self.google_calendar}  # Include primary calendar to prevent duplicates

        for linked_cal in self.linked_calendars:
            # Check for duplicates
            if linked_cal.calendar in seen_calendars:
                calendar_name = frappe.get_value("Google Calendar", linked_cal.calendar, "name")
                frappe.throw(
                    frappe._("Calendar '{0}' is already added. Please remove the duplicate entry.").format(
                        linked_cal.label or calendar_name
                    )
                )
            seen_calendars.add(linked_cal.calendar)

            # Check that the calendar is authorized
            calendar = frappe.get_doc("Google Calendar", linked_cal.calendar)
            if not calendar.custom_is_google_calendar_authorized:
                calendar_link = frappe.utils.get_link_to_form("Google Calendar", calendar.name, calendar.name)
                frappe.throw(
                    frappe._("Linked calendar '{0}' is not authorized. Please authorize it first: {1}").format(
                        linked_cal.label or calendar.name, calendar_link
                    )
                )

    def validate_slug(self):
        """Validate slug format and uniqueness."""
        if self.enable_scheduling and not self.slug:
            frappe.throw(frappe._("Please set a slug before enabling scheduling."))
        if self.slug:
            if not SLUG_REGEX.match(self.slug):
                frappe.throw(
                    frappe._(
                        "Slug can only contain lowercase alphanumeric characters, underscores and hyphens, and cannot start or end with a hyphen."
                    )
                )
            if frappe.db.exists("User Appointment Availability", {"slug": self.slug, "name": ["!=", self.name]}):
                frappe.throw(frappe._("Slug already exists. Please set a unique slug."))

    def validate_zoom_settings(self):
        """Validate Zoom configuration if Zoom is selected as meeting provider."""
        if not (self.enable_scheduling and self.meeting_provider == "Zoom"):
            return

        appointment_settings = frappe.get_single("Appointment Settings")
        appointment_settings_link = frappe.utils.get_link_to_form("Appointment Settings", None, "Appointment Settings")
        if not appointment_settings.enable_zoom:
            frappe.throw(frappe._(f"Zoom is not enabled. Please enable it from {appointment_settings_link}."))
        if (
            not appointment_settings.zoom_client_id
            or not appointment_settings.get_password("zoom_client_secret")
            or not appointment_settings.zoom_account_id
        ):
            frappe.throw(
                frappe._(f"Please set Zoom Account ID, Client ID and Secret in {appointment_settings_link}.")
            )
        calendar = frappe.get_doc("Google Calendar", self.google_calendar)
        if not calendar.custom_zoom_user_email:
            google_calendar_link = frappe.utils.get_link_to_form(
                "Google Calendar", calendar.name, "Google Calendar"
            )
            frappe.throw(frappe._(f"Please set Zoom User Email in {google_calendar_link}."))


def suggest_slug(og_slug: str):
    for i in range(1, 100):
        slug = f"{og_slug}{i}"
        if not frappe.db.exists("User Appointment Availability", {"slug": slug}):
            return slug
    return None


@frappe.whitelist()
def is_slug_available(slug: str):
    is_available = not frappe.db.exists("User Appointment Availability", {"slug": slug})
    suggested_slug = None
    if not is_available:
        suggested_slug = suggest_slug(slug)
    return {"is_available": is_available, "suggested_slug": suggested_slug}


def get_user_appointment_availability_slots(
    appointment_group: object, utc_start_time: datetime, utc_end_time: datetime
):
    members = appointment_group.members

    member_time_slots = {}

    global_interval = {
        "start_time": utc_start_time,
        "end_time": utc_end_time,
    }

    for member in members:
        if not member.is_mandatory:
            continue

        user_timezone = frappe.get_value("User", member.user, "time_zone")

        current_date = utc_start_time

        while current_date.date() <= utc_end_time.date():
            current_date_time = convert_utc_datetime_to_timezone(current_date, user_timezone)
            weekday = get_weekday(current_date_time)

            appointment_time_slots = frappe.db.get_all(
                APPOINTMENT_TIME_SLOT,
                filters={"parent": member.user, "day": weekday},
                fields="*",
            )

            user_appointment_time_slots_utc = []

            for slot in appointment_time_slots:
                interval = {
                    "start_time": convert_datetime_to_utc(update_time_of_datetime(current_date_time, slot.start_time)),
                    "end_time": convert_datetime_to_utc(
                        update_time_of_datetime(
                            current_date_time,
                            slot.end_time,
                        )
                    ),
                }

                interval = find_intersection_interval(interval, global_interval)

                if interval:
                    user_appointment_time_slots_utc.append(
                        {
                            "start_time": interval[0],
                            "end_time": interval[1],
                            "is_available": True,
                        }
                    )

            if member.user in member_time_slots:
                member_time_slots[member.user] += user_appointment_time_slots_utc
            else:
                member_time_slots[member.user] = user_appointment_time_slots_utc

            current_date = add_to_date(current_date, days=1)

    member_time_slots["tem"] = {
        "start_time": utc_start_time,
        "end_time": utc_end_time,
        "is_available": True,
    }

    return member_time_slots
