export interface MeetingMember {
  name: string;
  image: string | null;
  is_mandatory: boolean;
}

export interface Branding {
  cover_image?: string;
  header_color_light?: string;
  header_color_dark?: string;
  app_logo?: string;
}

export interface MeetingData {
  appointment_group_id: string;
  all_available_slots_for_data: any[]; // Define a more specific type if possible
  available_days: string[]; // Array of weekdays
  date: string;
  duration: number;
  endtime: string;
  is_invalid_date: boolean;
  next_valid_date: string;
  prev_valid_date: string;
  starttime: string;
  total_slots_for_day: number;
  valid_end_date: string;
  valid_start_date: string;
  meeting_details?: {
    email_address: string;
    name: string;
    reference_docname: string;
    round: string;
  };
  booked_slot?: bookedSlotType;
  title?: string;
  // Branding fields
  branding?: Branding;
  description?: string;
  members?: MeetingMember[];
  // Public booking
  allow_public_booking?: boolean;
  rescheduling_allowed?: boolean;
}

export interface bookedSlotType {
  start_time: string;
  end_time: string;
  meeting_provider: string;
  google_calendar_event_url: string;
  meet_link: string;
  reschedule_url: string;
}
