/**
 * External dependencies
 */
import { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, CircleAlert, Clock } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Internal dependencies
 */
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/tooltip";
import Typography from "@/components/typography";
import {
  capitalizeWords,
  cn,
  convertMinutesToTimeFormat,
  convertToMinutes,
  getAllSupportedTimeZones,
  getTimeZoneOffsetFromTimeZoneString,
  parseDateString,
  parseFrappeErrorMsg,
} from "@/lib/utils";
import { TimeFormat } from "../appointment/types";
import { Button } from "@/components/button";
import PoweredBy from "@/components/powered-by";
import { Switch } from "@/components/switch";
import TimeZoneSelect from "../appointment/components/timeZoneSelectmenu";
import GroupMeetSkeleton from "./components/groupMeetSkeleton";
import GroupMeetingForm from "./components/groupMeetingForm";
import { Skeleton } from "@/components/skeleton";
import { getIconForKey, validTitle } from "./utils";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import SuccessAlert from "@/components/success-alert";
import MetaTags from "@/components/meta-tags";
import { CalendarWrapper } from "@/components/calendar-wrapper";
import { useMeetingReducer } from "./reducer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar";
import { useTheme } from "@/components/theme-provider";

const GroupAppointment = () => {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme } = useTheme();
  const date = searchParams.get("date");
  const reschedule = searchParams.get("reschedule") || "";
  const event_token = searchParams.get("event_token") || "";
  const [timeFormat, setTimeFormat] = useState<TimeFormat>("12h");
  const [state, dispatch] = useMeetingReducer();

  // Determine if we're in dark mode
  const isDark = useMemo(() => {
    if (theme === "dark") return true;
    if (theme === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }, [theme]);

  // Get header background style based on branding settings
  const headerStyle = useMemo(() => {
    const branding = state.meetingData.branding;

    // Priority 1: Cover image from branding settings
    if (branding?.cover_image) {
      return {
        backgroundImage: `url(${branding.cover_image})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
    }

    // Priority 2: Custom color from branding
    const customColor = isDark ? branding?.header_color_dark : branding?.header_color_light;
    if (customColor) {
      return {
        backgroundColor: customColor,
      };
    }

    // Priority 3: Default (handled via className)
    return {};
  }, [state.meetingData.branding, isDark]);

  // Check if using default styling (no custom branding)
  const useDefaultStyle = Object.keys(headerStyle).length === 0;

  // Check if this is a public booking (no email params in URL)
  const isPublicBooking = useMemo(() => {
    const eventParticipants = searchParams.get("event_participants");
    return !eventParticipants || eventParticipants === "[]";
  }, [searchParams]);

  // Whether to show guest form (public booking enabled and no email params)
  const showGuestForm = useMemo(() => {
    return isPublicBooking && state.meetingData.allow_public_booking;
  }, [isPublicBooking, state.meetingData.allow_public_booking]);

  const {
    data,
    isLoading: dataIsLoading,
    error: fetchError,
    mutate,
  } = useFrappeGetCall(
    "frappe_appointment.api.group_meet.get_time_slots",
    {
      ...Object.fromEntries(searchParams),
      appointment_group_id: groupId,
      date: new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }).format(date ? parseDateString(date) : state.selectedDate),
      user_timezone_offset: String(
        getTimeZoneOffsetFromTimeZoneString(state.timeZone)
      ),
    },
    undefined,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      errorRetryCount: 3,
    }
  );

  const { call: bookMeeting, loading } = useFrappePostCall(
    "frappe_appointment.api.group_meet.book_time_slot"
  );

  useEffect(() => {
    if (data) {
      dispatch({ type: "SET_MEETING_DATA", payload: data.message });
      const validData = data.message.is_invalid_date
        ? new Date(data.message.next_valid_date)
        : state.selectedDate;
      dispatch({ type: "SET_SELECTED_DATE", payload: validData });
      dispatch({ type: "SET_DISPLAY_MONTH", payload: validData });
      updateDateQuery(validData);
    }
    if (fetchError) {
      navigate("/");
    }
  }, [data, fetchError, mutate, navigate, dispatch]);

  useEffect(() => {
    if (
      state.meetingData.booked_slot &&
      Object.keys(state.meetingData.booked_slot).length > 0
    ) {
      dispatch({ type: "SET_APPOINTMENT_SCHEDULED", payload: true });
      dispatch({
        type: "SET_SELECTED_SLOT",
        payload: {
          start_time: state.meetingData.booked_slot.start_time,
          end_time: state.meetingData.booked_slot.end_time,
        },
      });
      dispatch({
        type: "SET_BOOKING_RESPONSE",
        payload: {
          meet_link: state.meetingData.booked_slot.meet_link,
          meeting_provider: state.meetingData.booked_slot.meeting_provider,
          reschedule_url: state.meetingData.booked_slot.reschedule_url,
          google_calendar_event_url:
            state.meetingData.booked_slot.google_calendar_event_url,
          message: "Event scheduled",
          event_id: state.meetingData.booked_slot.reschedule_url,
        },
      });
    }
  }, [state.meetingData.booked_slot]);

  useEffect(() => {
    const handleResize = () => {
      dispatch({ type: "SET_MOBILE_VIEW", payload: window.innerWidth <= 768 });
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (date) {
      const dateObj = parseDateString(date);
      dispatch({ type: "SET_SELECTED_DATE", payload: dateObj });
      dispatch({ type: "SET_DISPLAY_MONTH", payload: dateObj });
      updateDateQuery(dateObj);
    }
  }, [date]);

  const updateDateQuery = (date: Date) => {
    const queries: Record<string, string> = {};
    searchParams.forEach((value, key) => (queries[key] = value));
    setSearchParams({
      ...queries,
      date: `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
    });
  };

  const formatTimeSlot = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "numeric",
      hour12: timeFormat === "12h",
      timeZone: state.timeZone,
    }).format(date);
  };

  const scheduleMeeting = (slot?: { start_time: string; end_time: string }) => {
    const slotToBook = slot || state.selectedSlot;
    if (!slotToBook) return;

    const meetingData: Record<string, any> = {
      ...Object.fromEntries(searchParams),
      appointment_group_id: groupId,
      date: new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }).format(state.selectedDate),
      user_timezone_offset: String(
        getTimeZoneOffsetFromTimeZoneString(state.timeZone)
      ),
      start_time: slotToBook.start_time,
      end_time: slotToBook.end_time,
    };

    bookMeeting(meetingData)
      .then((data) => {
        dispatch({ type: "SET_BOOKING_RESPONSE", payload: data.message });
        dispatch({ type: "SET_APPOINTMENT_SCHEDULED", payload: true });
        mutate();
      })
      .catch((err) => {
        const error = parseFrappeErrorMsg(err);
        toast(error || "Something went wrong", {
          duration: 4000,
          classNames: {
            actionButton:
              "group-[.toast]:!bg-red-500 group-[.toast]:hover:!bg-red-300 group-[.toast]:!text-white",
          },
          icon: <CircleAlert className="h-5 w-5 text-red-500" />,
          action: {
            label: "OK",
            onClick: () => toast.dismiss(),
          },
        });
      });
  };

  return (
    <>
      <MetaTags
        title={`${capitalizeWords(validTitle(state.meetingData.appointment_group_id)) ||
          "Group"
          } | Appointment`}
        description={`Book appointment with ${validTitle(
          state.meetingData.appointment_group_id
        )}`}
      // keywords="Group appointment"
      // author={state.meetingData.appointment_group_id}
      // robots="index, follow"
      // ogTitle={`${
      //   capitalizeWords(validTitle(state.meetingData.appointment_group_id)) ||
      //   "Group"
      // } | Scheduler`}
      // ogDescription={`Book appointment with ${validTitle(
      //   state.meetingData.appointment_group_id
      // )}`}
      // twitterCard="summary_large_image"
      // twitterTitle={`${
      //   capitalizeWords(validTitle(state.meetingData.appointment_group_id)) ||
      //   "Group"
      // } | Scheduler`}
      // twitterDescription={`Book appointment with ${validTitle(
      //   state.meetingData.appointment_group_id
      // )}`}
      />
      <div className="w-full flex justify-center items-center">
        <div className="w-full xl:w-4/5 2xl:w-3/5 md:py-6 md:px-4">
          <div className="h-fit flex flex-col w-full md:border md:rounded-lg overflow-hidden">
            {/* Cover Header */}
            <div
              className={cn(
                "w-full h-24 md:h-32 relative",
                useDefaultStyle && "bg-blue-100 dark:bg-zinc-800"
              )}
              style={headerStyle}
            />

            {/* Main Content */}
            <div className="flex w-full max-lg:flex-col p-6 max-lg:gap-5">
              {/* Group Meet Details */}
              {!state.meetingData.appointment_group_id ? (
                <GroupMeetSkeleton />
              ) : (
                <div className="flex flex-col w-full lg:w-64 lg:min-w-64 shrink-0 gap-3">
                  {/* Meeting Title */}
                  <div className="flex flex-col gap-2">
                    <Typography
                      variant="h2"
                      className="text-3xl font-semibold text-left w-full capitalize"
                    >
                      {validTitle(state.meetingData.title || state.meetingData.appointment_group_id)}
                    </Typography>

                    {state.meetingData.description && (
                      <Typography className="text-sm text-muted-foreground">
                        {state.meetingData.description}
                      </Typography>
                    )}
                  </div>
                  {state.meetingData && (
                    <div className="w-full flex flex-col gap-2 mt-3">
                      {state.meetingData.meeting_details &&
                        Object.entries(state.meetingData.meeting_details).map(
                          ([key, value]) => {
                            const Icon = getIconForKey(key);
                            return (
                              <div
                                key={key}
                                className="flex cursor-default items-center gap-2 w-full "
                              >
                                <div className="w-full truncate text-gray-600 dark:text-gray-400 flex items-center justify-start gap-2">
                                  <Icon className="h-4 w-4 shrink-0" />
                                  <Tooltip>
                                    <TooltipTrigger className="text-left truncate">
                                      <Typography
                                        className={cn(
                                          "truncate font-medium text-gray-600 dark:text-gray-400",
                                          key.includes("name") &&
                                          "text-foreground",
                                          key.includes("email")
                                            ? ""
                                            : "capitalize"
                                        )}
                                      >
                                        {value}
                                      </Typography>
                                    </TooltipTrigger>
                                    <TooltipContent className="capitalize">
                                      <span className="text-blue-600">
                                        {validTitle(key)}
                                      </span>{" "}
                                      : {value}
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </div>
                            );
                          }
                        )}
                      <div className="flex cursor-default items-center gap-2 w-full ">
                        <div className="w-full truncate text-gray-600 dark:text-gray-400 flex items-center justify-start gap-2">
                          <Clock className="h-4 w-4 shrink-0" />
                          <Tooltip>
                            <TooltipTrigger className="text-left truncate">
                              <Typography className="truncate font-medium text-gray-600 dark:text-gray-400">
                                {convertMinutesToTimeFormat(convertToMinutes(
                                  state.meetingData.duration
                                ).toString())}{" "}
                                Meeting
                              </Typography>
                            </TooltipTrigger>
                            <TooltipContent className="capitalize">
                              <span className="text-blue-600">duration</span> :{" "}
                              {convertMinutesToTimeFormat(convertToMinutes(
                                state.meetingData.duration
                              ).toString())}{" "}
                              Meeting
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>

                      {/* Member Avatars with Names */}
                      {state.meetingData.members && state.meetingData.members.length > 0 && (
                        <div className="flex flex-col gap-2 mt-2">
                          {state.meetingData.members.map((member, index) => (
                            <div key={index} className="flex items-center gap-2">
                              <Avatar className="h-6 w-6 border border-background shadow-sm">
                                <AvatarImage
                                  src={member.image || undefined}
                                  alt={member.name}
                                  className="object-cover"
                                />
                                <AvatarFallback className="text-[10px] bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300">
                                  {(member.name || '').split(' ').map(n => n?.[0] || '').join('').slice(0, 2).toUpperCase() || '?'}
                                </AvatarFallback>
                              </Avatar>
                              <Typography className="text-sm font-medium text-gray-600 dark:text-gray-400">
                                {member.name || 'Unknown'}
                              </Typography>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              )}
              <hr className="w-full bg-muted md:hidden" />

              {/* Calendar, Slots, and Meeting Form with Animation */}
              <div className="max-lg:w-full flex-1 lg:max-h-[31rem] md:overflow-hidden">
                <AnimatePresence mode="wait">
                  {!state.showMeetingForm && (
                    <motion.div
                      key="calendar-slots"
                      initial={state.isMobileView ? {} : { x: "-100%", opacity: 1 }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={state.isMobileView ? {} : { x: "-100%", opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="w-full flex max-lg:flex-col gap-4"
                    >
                      {(!state.isMobileView || !state.expanded) && (
                        <div className="flex flex-col w-full lg:flex-1">
                          {/* Calendar View */}
                          <div className="w-full">
                            <CalendarWrapper
                              displayMonth={state.displayMonth}
                              selectedDate={state.selectedDate}
                              loading={loading}
                              setDisplayMonth={(date) =>
                                dispatch({ type: "SET_DISPLAY_MONTH", payload: date })
                              }
                              meetingData={{
                                valid_start_date: state.meetingData.valid_start_date,
                                valid_end_date: state.meetingData.valid_end_date,
                                available_days: state.meetingData.available_days,
                              }}
                              setSelectedDate={(date) =>
                                dispatch({ type: "SET_SELECTED_DATE", payload: date })
                              }
                              onDayClick={(date) => {
                                dispatch({ type: "SET_SELECTED_DATE", payload: date });
                                dispatch({ type: "SET_DISPLAY_MONTH", payload: date });
                                dispatch({ type: "SET_EXPANDED", payload: true });
                                dispatch({
                                  type: "SET_SELECTED_SLOT",
                                  payload: {
                                    start_time: "",
                                    end_time: "",
                                  },
                                });
                                updateDateQuery(date);
                              }}
                              className="rounded-md md:border md:h-96 w-full flex lg:px-6 lg:p-2 p-0"
                            />
                          </div>
                          <div className="w-full mt-4 gap-5 flex max-md:flex-col md:justify-between md:items-center">
                            {/* Timezone */}
                            <TimeZoneSelect
                              timeZones={getAllSupportedTimeZones()}
                              setTimeZone={(tz) =>
                                dispatch({ type: "SET_TIMEZONE", payload: tz })
                              }
                              timeZone={state.timeZone}
                              disable={loading}
                            />

                            {/* Time Format Toggle */}
                            <div className="flex items-center gap-2">
                              <Typography className="text-sm text-gray-700">
                                AM/PM
                              </Typography>
                              <Switch
                                disabled={loading}
                                className="data-[state=checked]:bg-blue-500 active:ring-blue-400 focus-visible:ring-blue-400"
                                checked={timeFormat === "24h"}
                                onCheckedChange={(checked) =>
                                  setTimeFormat(checked ? "24h" : "12h")
                                }
                              />
                              <Typography className="text-sm text-gray-700">
                                24H
                              </Typography>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Mobile Bottom Bar */}
                      {state.isMobileView && state.expanded && !state.showMeetingForm && (
                        <div className="h-14 fixed bottom-0 left-0 w-screen border z-10 bg-background border-top flex items-center justify-between px-4">
                          <Button
                            variant="link"
                            className="text-blue-500 dark:text-blue-400 px-0"
                            onClick={() =>
                              dispatch({ type: "SET_EXPANDED", payload: false })
                            }
                            disabled={loading}
                          >
                            <ArrowLeft className="h-4 w-4" />
                            Back
                          </Button>
                        </div>
                      )}

                      {/* Available Slots */}
                      <div
                        className={cn(
                          "w-full flex flex-col lg:w-56 lg:min-w-56 shrink-0 gap-2 lg:px-5",
                          !state.expanded && "max-md:hidden"
                        )}
                      >
                        <Typography
                          variant="h3"
                          className="text-sm font-semibold lg:w-full truncate"
                        >
                          {format(state.selectedDate, "EEEE, d MMMM yyyy")}
                        </Typography>

                        {dataIsLoading ? (
                          <div className="h-full flex flex-col w-full mb-3 overflow-y-auto no-scrollbar space-y-2">
                            {Array.from({ length: 5 }).map((_, key) => (
                              <Skeleton key={key} className="w-full h-10" />
                            ))}
                          </div>
                        ) : (
                          <div className="lg:h-[22rem] mb-3 overflow-y-auto no-scrollbar space-y-2">
                            {state.meetingData.all_available_slots_for_data.length > 0 ? (
                              state.meetingData.all_available_slots_for_data.map(
                                (slot, index) => (
                                  <Button
                                    key={index}
                                    onClick={() => {
                                      const selectedSlot = {
                                        start_time: slot.start_time,
                                        end_time: slot.end_time,
                                      };
                                      dispatch({
                                        type: "SET_SELECTED_SLOT",
                                        payload: selectedSlot,
                                      });
                                      // For public bookings, show the form
                                      // For non-public bookings (with email params), schedule directly
                                      if (showGuestForm) {
                                        dispatch({ type: "SET_SHOW_MEETING_FORM", payload: true });
                                      } else if (reschedule && event_token) {
                                        // Handle reschedule - just select the slot
                                      } else {
                                        // Non-public booking - schedule directly
                                        scheduleMeeting(selectedSlot);
                                      }
                                    }}
                                    disabled={loading}
                                    variant="outline"
                                    className={cn(
                                      "w-full font-normal border border-blue-500 dark:border-blue-400 text-blue-500 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-800/10 transition-colors",
                                      state.selectedSlot?.start_time === slot.start_time &&
                                      state.selectedSlot?.end_time === slot.end_time &&
                                      "bg-blue-500 dark:bg-blue-400 text-background dark:text-background hover:bg-blue-500 dark:hover:bg-blue-400 hover:text-background dark:hover:text-background"
                                    )}
                                  >
                                    {formatTimeSlot(new Date(slot.start_time))}
                                  </Button>
                                )
                              )
                            ) : (
                              <div className="h-full max-md:h-44 w-full flex justify-center items-center">
                                <Typography className="text-center text-gray-500">
                                  No open-time slots
                                </Typography>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* Meeting Form for Public Bookings */}
                  {state.showMeetingForm && state.selectedSlot && (
                    <GroupMeetingForm
                      key="meeting-form"
                      onSuccess={(data) => {
                        dispatch({ type: "SET_SHOW_MEETING_FORM", payload: false });
                        dispatch({ type: "SET_EXPANDED", payload: false });
                        mutate();
                        dispatch({ type: "SET_BOOKING_RESPONSE", payload: data.message });
                        dispatch({ type: "SET_APPOINTMENT_SCHEDULED", payload: true });
                      }}
                      onBack={() => {
                        dispatch({ type: "SET_SHOW_MEETING_FORM", payload: false });
                        dispatch({ type: "SET_EXPANDED", payload: false });
                      }}
                      appointmentGroupId={groupId || ""}
                      selectedDate={state.selectedDate}
                      selectedSlot={state.selectedSlot}
                      timeZone={state.timeZone}
                      isMobileView={state.isMobileView}
                    />
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>
      <PoweredBy appLogo={state.meetingData.branding?.app_logo} />
      {state.selectedSlot?.start_time && (
        <SuccessAlert
          open={state.appointmentScheduled}
          setOpen={(open) =>
            dispatch({ type: "SET_APPOINTMENT_SCHEDULED", payload: open })
          }
          selectedSlot={state.selectedSlot}
          meetingProvider={state.bookingResponse.meeting_provider}
          meetLink={state.bookingResponse.meet_link}
          rescheduleLink={state.bookingResponse.reschedule_url}
          calendarString={state.bookingResponse.google_calendar_event_url}
          disableClose={
            state.meetingData.booked_slot &&
              Object.keys(state.meetingData.booked_slot).length > 0
              ? true
              : false
          }
        />
      )}
    </>
  );
};

export default GroupAppointment;
