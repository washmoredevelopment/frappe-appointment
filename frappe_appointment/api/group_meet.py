import json

import frappe
import frappe.utils
from frappe import _

from frappe_appointment.frappe_appointment.doctype.appointment_group.appointment_group import _get_time_slots_for_day
from frappe_appointment.helpers.overrides import add_response_code
from frappe_appointment.overrides.event_override import APPOINTMENT_GROUP, _create_event_for_appointment_group


@frappe.whitelist(allow_guest=True)
@add_response_code
def get_time_slots(appointment_group_id: str, date: str, user_timezone_offset: str, **args):
    if not appointment_group_id:
        frappe.throw(_("Appointment Group ID is required"))

    if not date:
        frappe.throw(_("Date is required"))

    appointment_group = frappe.get_doc(APPOINTMENT_GROUP, appointment_group_id)

    time_slots = _get_time_slots_for_day(appointment_group, date, user_timezone_offset)
    if time_slots and isinstance(time_slots, dict):
        time_slots["title"] = appointment_group.group_name
        time_slots["rescheduling_allowed"] = bool(appointment_group.allow_rescheduling)
        # Add branding and public booking fields
        time_slots["description"] = appointment_group.description
        time_slots["allow_public_booking"] = bool(appointment_group.allow_public_booking)
        
        # Get app logo from Website Settings
        time_slots["app_logo"] = frappe.db.get_single_value("Website Settings", "app_logo")
        
        # Get member profile pictures
        members = []
        for member in appointment_group.members:
            # member.user is a User Appointment Availability reference
            user_email = frappe.db.get_value("User Appointment Availability", member.user, "user")
            if user_email:
                user_data = frappe.db.get_value("User", user_email, ["full_name", "user_image"], as_dict=True)
                if user_data:
                    members.append({
                        "name": user_data.full_name,
                        "image": user_data.user_image,
                        "is_mandatory": member.is_mandatory
                    })
        time_slots["members"] = members
    return time_slots


@frappe.whitelist(allow_guest=True)
@add_response_code
def book_time_slot(
    appointment_group_id: str,
    date: str,
    start_time: str,
    end_time: str,
    user_timezone_offset: str,
    user_name: str = None,
    user_email: str = None,
    **args,
):
    appointment_group = frappe.get_doc(APPOINTMENT_GROUP, appointment_group_id)

    # Check if this is a public booking (no event_participants in args)
    event_participants = args.get("event_participants")
    is_public_booking = not event_participants or event_participants == "[]"

    if is_public_booking:
        # Validate public booking is allowed
        if not appointment_group.allow_public_booking:
            frappe.throw(_("Public booking is not enabled for this appointment group."))

        # Validate required fields for public booking
        if not user_name or not user_email:
            frappe.throw(_("Name and email are required for booking."))

        # Create event_participants from user_name and user_email
        event_participants = json.dumps([
            {
                "email": user_email,
            }
        ])
        args["event_participants"] = event_participants

        # Create custom_doctype_link_with_event if not provided
        if not args.get("custom_doctype_link_with_event"):
            args["custom_doctype_link_with_event"] = json.dumps([
                {
                    "reference_doctype": "Appointment Group",
                    "reference_docname": appointment_group.name,
                    "value": user_email,
                }
            ])

        # Set subject if not provided
        if not args.get("subject"):
            args["subject"] = f"{appointment_group.group_name}: {user_name}"

    resp = _create_event_for_appointment_group(
        appointment_group=appointment_group,
        date=date,
        start_time=start_time,
        end_time=end_time,
        user_timezone_offset=user_timezone_offset,
        return_event_id=True,
        **args,
    )
    return resp
