using System.Collections.Generic;
using UnityEngine.Events;

public static class EventManager
{
    public static UnityEvent<List<SkillInput?>> OnMultipleInputsSent = new();
    public static UnityEvent<SkillInput> OnSkillInputReceived = new();
    public static UnityEvent<SkillInput> OnSkillInputReceivedFromStick = new();

    public static UnityEvent OnSequenceSuccess = new();

    public static UnityEvent OnSequenceFailed = new();

    public static UnityEvent OnWholeSessionFailed = new();
}
