/**
 * External dependencies.
 */
import { useForm } from "react-hook-form";
import { motion } from "framer-motion";
import z from "zod";
import { useFrappePostCall } from "frappe-react-sdk";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarPlus, ChevronLeft, CircleAlert } from "lucide-react";
import { formatDate } from "date-fns";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";

/**
 * Internal dependencies.
 */
import { Button } from "@/components/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/form";
import { Input } from "@/components/input";
import Typography from "@/components/typography";
import {
  getTimeZoneOffsetFromTimeZoneString,
  parseFrappeErrorMsg,
} from "@/lib/utils";
import Spinner from "@/components/spinner";

const contactFormSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
});

type ContactFormValues = z.infer<typeof contactFormSchema>;

interface GroupMeetingFormProps {
  onBack: VoidFunction;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSuccess: (data: any) => void;
  appointmentGroupId: string;
  selectedDate: Date;
  selectedSlot: { start_time: string; end_time: string };
  timeZone: string;
  isMobileView: boolean;
}

const GroupMeetingForm = ({
  onBack,
  appointmentGroupId,
  selectedDate,
  selectedSlot,
  timeZone,
  onSuccess,
  isMobileView,
}: GroupMeetingFormProps) => {
  const { call: bookMeeting, loading } = useFrappePostCall(
    `frappe_appointment.api.group_meet.book_time_slot`
  );
  const [searchParams] = useSearchParams();

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      fullName: "",
      email: "",
    },
  });

  const onSubmit = (data: ContactFormValues) => {
    const extraArgs: Record<string, string> = {};
    searchParams.forEach((value, key) => (extraArgs[key] = value));
    
    const meetingData = {
      ...extraArgs,
      appointment_group_id: appointmentGroupId,
      date: new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }).format(selectedDate),
      user_timezone_offset: String(
        getTimeZoneOffsetFromTimeZoneString(timeZone)
      ),
      start_time: selectedSlot.start_time,
      end_time: selectedSlot.end_time,
      user_name: data.fullName,
      user_email: data.email,
    };

    bookMeeting(meetingData)
      .then((data) => {
        onSuccess(data);
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
    <motion.div
      key="group-meeting-form"
      className={`w-full md:min-h-[28rem] lg:w-[41rem] shrink-0 md:p-6 md:px-4`}
      initial={isMobileView ? {} : { x: "100%" }}
      animate={{ x: 0 }}
      exit={isMobileView ? {} : { x: "100%" }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
    >
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-6 h-full flex justify-between flex-col"
        >
          <div className="space-y-4">
            <div className="flex gap-3 max-md:flex-col md:items-center md:justify-between">
              <Typography variant="p" className="text-2xl">
                Your contact info
              </Typography>
              <Typography className="text-sm mt-1 text-blue-500 dark:text-blue-400">
                <CalendarPlus className="inline-block w-4 h-4 mr-1 md:hidden" />
                {formatDate(selectedDate, "d MMM, yyyy")}
              </Typography>
            </div>

            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel
                    className={`${
                      form.formState.errors.fullName ? "text-red-500" : ""
                    }`}
                  >
                    Full Name{" "}
                    <span className="text-red-500 dark:text-red-600">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      disabled={loading}
                      className={`active:ring-blue-400 focus-visible:ring-blue-400 ${
                        form.formState.errors.fullName
                          ? "active:ring-red-500 focus-visible:ring-red-500"
                          : ""
                      }`}
                      placeholder="John Doe"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage
                    className={`${
                      form.formState.errors.fullName ? "text-red-500" : ""
                    }`}
                  />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel
                    className={`${
                      form.formState.errors.email ? "text-red-500" : ""
                    }`}
                  >
                    Email{" "}
                    <span className="text-red-500 dark:text-red-600">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      disabled={loading}
                      className={`active:ring-blue-400 focus-visible:ring-blue-400 ${
                        form.formState.errors.email
                          ? "active:ring-red-500 focus-visible:ring-red-500"
                          : ""
                      }`}
                      placeholder="john.doe@gmail.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage
                    className={`${
                      form.formState.errors.email ? "text-red-500" : ""
                    }`}
                  />
                  <Typography className="text-xs text-muted-foreground mt-1">
                    You'll receive a calendar invite at this email
                  </Typography>
                </FormItem>
              )}
            />
          </div>

          <div className="flex justify-between md:pt-4 max-md:h-14 max-md:fixed max-md:bottom-0 max-md:left-0 max-md:w-screen max-md:border max-md:z-10 max-md:bg-background max-md:border-top max-md:items-center max-md:px-4">
            <Button
              type="button"
              className="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-400 md:hover:bg-blue-50 md:dark:hover:bg-blue-800/10 max-md:px-0 max-md:hover:underline max-md:hover:bg-transparent"
              onClick={onBack}
              variant="ghost"
              disabled={loading}
            >
              <ChevronLeft /> Back
            </Button>
            <Button
              disabled={loading}
              className="bg-blue-500 dark:bg-blue-400 hover:bg-blue-500 dark:hover:bg-blue-400"
              type="submit"
            >
              {loading && <Spinner />} Schedule Meeting
            </Button>
          </div>
        </form>
      </Form>
    </motion.div>
  );
};

export default GroupMeetingForm;

